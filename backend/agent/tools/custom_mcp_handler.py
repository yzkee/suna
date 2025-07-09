import json
import asyncio
from typing import Dict, Any, List
from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client
from utils.logger import logger
from .mcp_connection_manager import MCPConnectionManager


class CustomMCPHandler:
    def __init__(self, connection_manager: MCPConnectionManager):
        self.connection_manager = connection_manager
        self.custom_tools: Dict[str, Dict[str, Any]] = {}
    
    async def initialize_custom_mcps(self, custom_configs: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        for config in custom_configs:
            try:
                await self._initialize_single_custom_mcp(config)
            except Exception as e:
                logger.error(f"Failed to initialize custom MCP {config.get('name', 'Unknown')}: {e}")
                continue
        
        return self.custom_tools
    
    async def _initialize_single_custom_mcp(self, config: Dict[str, Any]):
        custom_type = config.get('customType', 'sse')
        server_config = config.get('config', {})
        enabled_tools = config.get('enabledTools', [])
        server_name = config.get('name', 'Unknown')
        
        logger.info(f"Initializing custom MCP: {server_name} (type: {custom_type})")
        
        if custom_type == 'pipedream':
            await self._initialize_pipedream_mcp(server_name, server_config, enabled_tools)
        elif custom_type == 'sse':
            await self._initialize_sse_mcp(server_name, server_config, enabled_tools)
        elif custom_type == 'http':
            await self._initialize_http_mcp(server_name, server_config, enabled_tools)
        elif custom_type == 'json':
            await self._initialize_json_mcp(server_name, server_config, enabled_tools)
        else:
            logger.error(f"Custom MCP {server_name}: Unsupported type '{custom_type}'")
    
    async def _initialize_pipedream_mcp(self, server_name: str, server_config: Dict[str, Any], enabled_tools: List[str]):
        app_slug = server_config.get('app_slug')
        if not app_slug and 'headers' in server_config and 'x-pd-app-slug' in server_config['headers']:
            app_slug = server_config['headers']['x-pd-app-slug']
            server_config['app_slug'] = app_slug
        
        external_user_id = await self._resolve_external_user_id(server_config)
        if not external_user_id:
            logger.error(f"Custom MCP {server_name}: Missing external_user_id for Pipedream")
            return
        
        server_config['external_user_id'] = external_user_id
        oauth_app_id = server_config.get('oauth_app_id')
        
        logger.info(f"Initializing Pipedream MCP for {app_slug} (user: {external_user_id}, oauth_app_id: {oauth_app_id})")
        
        try:
            from pipedream.client import get_pipedream_client
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client
            
            client = get_pipedream_client()
            access_token = await client._obtain_access_token()
            await client._ensure_rate_limit_token()
            
            headers = {
                "Authorization": f"Bearer {access_token}",
                "x-pd-project-id": client.config.project_id,
                "x-pd-environment": client.config.environment,
                "x-pd-external-user-id": external_user_id,
                "x-pd-app-slug": app_slug,
            }
            
            if client.rate_limit_token:
                headers["x-pd-rate-limit"] = client.rate_limit_token
            
            if oauth_app_id:
                headers["x-pd-oauth-app-id"] = oauth_app_id

            url = "https://remote.mcp.pipedream.net"
            
            async with streamablehttp_client(url, headers=headers) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    tools_result = await session.list_tools()
                    tools = tools_result.tools if hasattr(tools_result, 'tools') else tools_result
                    
                    self._register_custom_tools(tools, server_name, enabled_tools, 'pipedream', server_config)
                    
        except Exception as e:
            logger.error(f"Pipedream MCP {server_name}: Connection failed - {str(e)}")
            raise
    
    async def _initialize_sse_mcp(self, server_name: str, server_config: Dict[str, Any], enabled_tools: List[str]):
        if 'url' not in server_config:
            logger.error(f"Custom MCP {server_name}: Missing 'url' in config")
            return
        
        server_info = await self.connection_manager.connect_sse_server(server_name, server_config)
        if server_info.get('status') == 'connected':
            tools_info = server_info.get('tools', [])
            self._register_custom_tools_from_info(tools_info, server_name, enabled_tools, 'sse', server_config)
        else:
            logger.error(f"Failed to connect to custom MCP {server_name}")
    
    async def _initialize_http_mcp(self, server_name: str, server_config: Dict[str, Any], enabled_tools: List[str]):
        if 'url' not in server_config:
            logger.error(f"Custom MCP {server_name}: Missing 'url' in config")
            return
        
        server_info = await self.connection_manager.connect_http_server(server_name, server_config)
        if server_info.get('status') == 'connected':
            tools_info = server_info.get('tools', [])
            self._register_custom_tools_from_info(tools_info, server_name, enabled_tools, 'http', server_config)
        else:
            logger.error(f"Failed to connect to custom MCP {server_name}")
    
    async def _initialize_json_mcp(self, server_name: str, server_config: Dict[str, Any], enabled_tools: List[str]):
        if 'command' not in server_config:
            logger.error(f"Custom MCP {server_name}: Missing 'command' in config")
            return
        
        server_info = await self.connection_manager.connect_stdio_server(server_name, server_config)
        if server_info.get('status') == 'connected':
            tools_info = server_info.get('tools', [])
            self._register_custom_tools_from_info(tools_info, server_name, enabled_tools, 'json', server_config)
        else:
            logger.error(f"Failed to connect to custom MCP {server_name}")
    
    async def _resolve_external_user_id(self, server_config: Dict[str, Any]) -> str:
        profile_id = server_config.get('profile_id')
        external_user_id = server_config.get('external_user_id')
        
        if not profile_id:
            return external_user_id
        
        try:
            from services.supabase import DBConnection
            from utils.encryption import decrypt_data
            
            db = DBConnection()
            supabase = await db.client
            
            result = await supabase.table('user_mcp_credential_profiles').select(
                'encrypted_config'
            ).eq('profile_id', profile_id).single().execute()
            
            if result.data:
                decrypted_config = decrypt_data(result.data['encrypted_config'])
                config_data = json.loads(decrypted_config)
                profile_external_user_id = config_data.get('external_user_id')
                
                if external_user_id and external_user_id != profile_external_user_id:
                    logger.warning(f"Overriding external_user_id {external_user_id} with profile's external_user_id {profile_external_user_id}")
                
                if 'oauth_app_id' in config_data:
                    server_config['oauth_app_id'] = config_data['oauth_app_id']
                
                return profile_external_user_id
            else:
                logger.error(f"Profile {profile_id} not found")
                return None
                
        except Exception as e:
            logger.error(f"Failed to resolve profile {profile_id}: {str(e)}")
            return None
    
    def _register_custom_tools(self, tools, server_name: str, enabled_tools: List[str], custom_type: str, server_config: Dict[str, Any]):
        tools_registered = 0
        
        for tool in tools:
            tool_name_from_server = tool.name
            if not enabled_tools or tool_name_from_server in enabled_tools:
                tool_name = f"custom_{server_name.replace(' ', '_').lower()}_{tool_name_from_server}"
                self.custom_tools[tool_name] = {
                    'name': tool_name,
                    'description': tool.description,
                    'parameters': tool.inputSchema,
                    'server': server_name,
                    'original_name': tool_name_from_server,
                    'is_custom': True,
                    'custom_type': custom_type,
                    'custom_config': server_config
                }
                tools_registered += 1
                logger.debug(f"Registered custom tool: {tool_name}")
        
        logger.info(f"Successfully initialized custom MCP {server_name} with {tools_registered} tools")
    
    def _register_custom_tools_from_info(self, tools_info: List[Dict[str, Any]], server_name: str, enabled_tools: List[str], custom_type: str, server_config: Dict[str, Any]):
        tools_registered = 0
        
        for tool_info in tools_info:
            tool_name_from_server = tool_info['name']
            if not enabled_tools or tool_name_from_server in enabled_tools:
                tool_name = f"custom_{server_name.replace(' ', '_').lower()}_{tool_name_from_server}"
                self.custom_tools[tool_name] = {
                    'name': tool_name,
                    'description': tool_info['description'],
                    'parameters': tool_info['input_schema'],
                    'server': server_name,
                    'original_name': tool_name_from_server,
                    'is_custom': True,
                    'custom_type': custom_type,
                    'custom_config': server_config
                }
                tools_registered += 1
                logger.debug(f"Registered custom tool: {tool_name}")
        
        logger.info(f"Successfully initialized custom MCP {server_name} with {tools_registered} tools")
    
    def get_custom_tools(self) -> Dict[str, Dict[str, Any]]:
        return self.custom_tools.copy() 