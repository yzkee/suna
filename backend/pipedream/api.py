from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import asyncio
import time

from utils.logger import logger
from utils.auth_utils import get_current_user_id_from_jwt
from .client import get_pipedream_client
from .profiles import (
    get_profile_manager, 
    PipedreamProfile, 
    CreateProfileRequest, 
    UpdateProfileRequest
)

router = APIRouter(prefix="/pipedream", tags=["pipedream"])
db = None

def initialize(database):
    """Initialize the pipedream API with database connection."""
    global db
    db = database

class CreateConnectionTokenRequest(BaseModel):
    app: Optional[str] = None

class ConnectionTokenResponse(BaseModel):
    success: bool
    link: Optional[str] = None
    token: Optional[str] = None
    external_user_id: str
    app: Optional[str] = None
    expires_at: Optional[str] = None
    error: Optional[str] = None

class ConnectionResponse(BaseModel):
    success: bool
    connections: List[Dict[str, Any]]
    count: int
    error: Optional[str] = None

class HealthCheckResponse(BaseModel):
    status: str
    project_id: str
    environment: str
    has_access_token: bool
    error: Optional[str] = None

class TriggerWorkflowRequest(BaseModel):
    workflow_id: str
    payload: Dict[str, Any]

class TriggerWorkflowResponse(BaseModel):
    success: bool
    workflow_id: str
    run_id: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None

class MCPDiscoveryRequest(BaseModel):
    app_slug: Optional[str] = None
    oauth_app_id: Optional[str] = None

class MCPProfileDiscoveryRequest(BaseModel):
    external_user_id: str
    app_slug: Optional[str] = None
    oauth_app_id: Optional[str] = None

class MCPDiscoveryResponse(BaseModel):
    success: bool
    mcp_servers: List[Dict[str, Any]]
    count: int
    error: Optional[str] = None

class MCPConnectionRequest(BaseModel):
    app_slug: str
    oauth_app_id: Optional[str] = None

class MCPConnectionResponse(BaseModel):
    success: bool
    mcp_config: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@router.post("/connection-token", response_model=ConnectionTokenResponse)
async def create_connection_token(
    request: CreateConnectionTokenRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Creating Pipedream connection token for user: {user_id}, app: {request.app}")
    
    try:
        client = get_pipedream_client()
        result = await client.create_connection_token(user_id, request.app)
        
        logger.info(f"Successfully created connection token for user: {user_id}")
        return ConnectionTokenResponse(
            success=True,
            link=result.get("connect_link_url"),
            token=result.get("token"),
            external_user_id=user_id,
            app=request.app,
            expires_at=result.get("expires_at")
        )
        
    except Exception as e:
        logger.error(f"Failed to create connection token for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create connection token: {str(e)}"
        )

@router.get("/connections", response_model=ConnectionResponse)
async def get_user_connections(
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Getting Pipedream connections for user: {user_id}")
    try:
        client = get_pipedream_client()
        connections = await client.get_connections(user_id)
        
        logger.info(f"Successfully retrieved {len(connections)} connections for user: {user_id}")
        return ConnectionResponse(
            success=True,
            connections=connections,
            count=len(connections)
        )
        
    except Exception as e:
        logger.error(f"Failed to get connections for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get connections: {str(e)}"
        )

@router.post("/mcp/discover", response_model=MCPDiscoveryResponse)
async def discover_mcp_servers(
    request: MCPDiscoveryRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Discovering MCP servers for user: {user_id}, app: {request.app_slug}")
    
    try:
        client = get_pipedream_client()
        mcp_servers = await client.discover_mcp_servers(
            external_user_id=user_id,
            app_slug=request.app_slug,
            oauth_app_id=request.oauth_app_id
        )
        
        logger.info(f"Successfully discovered {len(mcp_servers)} MCP servers for user: {user_id}")
        return MCPDiscoveryResponse(
            success=True,
            mcp_servers=mcp_servers,
            count=len(mcp_servers)
        )
        
    except Exception as e:
        logger.error(f"Failed to discover MCP servers for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to discover MCP servers: {str(e)}"
        )

@router.post("/mcp/discover-profile", response_model=MCPDiscoveryResponse)
async def discover_mcp_servers_for_profile(
    request: MCPProfileDiscoveryRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Discover MCP servers for a specific profile's external_user_id"""
    logger.info(f"Discovering MCP servers for external_user_id: {request.external_user_id}, app: {request.app_slug}")
    
    try:
        client = get_pipedream_client()
        mcp_servers = await client.discover_mcp_servers(
            external_user_id=request.external_user_id,
            app_slug=request.app_slug,
            oauth_app_id=request.oauth_app_id
        )
        
        logger.info(f"Successfully discovered {len(mcp_servers)} MCP servers for external_user_id: {request.external_user_id}")
        return MCPDiscoveryResponse(
            success=True,
            mcp_servers=mcp_servers,
            count=len(mcp_servers)
        )
        
    except Exception as e:
        logger.error(f"Failed to discover MCP servers for external_user_id {request.external_user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to discover MCP servers: {str(e)}"
        )

@router.post("/mcp/connect", response_model=MCPConnectionResponse)
async def create_mcp_connection(
    request: MCPConnectionRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Creating MCP connection for user: {user_id}, app: {request.app_slug}")
    try:
        client = get_pipedream_client()
        mcp_config = await client.create_mcp_connection(
            external_user_id=user_id,
            app_slug=request.app_slug,
            oauth_app_id=request.oauth_app_id
        )
        logger.info(f"Successfully created MCP connection for user: {user_id}, app: {request.app_slug}")
        return MCPConnectionResponse(
            success=True,
            mcp_config=mcp_config
        )
    except Exception as e:
        logger.error(f"Failed to create MCP connection for user {user_id}, app {request.app_slug}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create MCP connection: {str(e)}"
        )

@router.post("/mcp/discover-custom", response_model=Dict[str, Any])
async def discover_pipedream_mcp_tools(
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Discovering all Pipedream MCP tools for user: {user_id}")
    
    try:
        client = get_pipedream_client()
        
        mcp_servers = await client.discover_mcp_servers(
            external_user_id=user_id
        )
        custom_mcps = []
        for server in mcp_servers:
            if server.get('status') == 'connected':
                custom_mcp = {
                    'name': server['app_name'],
                    'type': 'pipedream',
                    'config': {
                        'app_slug': server['app_slug'],
                        'external_user_id': user_id,
                        'oauth_app_id': server.get('oauth_app_id')
                    },
                    'tools': server.get('available_tools', []),
                    'count': len(server.get('available_tools', []))
                }
                custom_mcps.append(custom_mcp)
        
        logger.info(f"Found {len(custom_mcps)} Pipedream MCP servers for user: {user_id}")
        
        return {
            "success": True,
            "servers": custom_mcps,
            "count": len(custom_mcps)
        }
        
    except Exception as e:
        logger.error(f"Failed to discover Pipedream MCP tools for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to discover Pipedream MCP tools: {str(e)}"
        )

@router.get("/mcp/available-tools", response_model=Dict[str, Any])
async def get_available_pipedream_tools(
    user_id: str = Depends(get_current_user_id_from_jwt),
    force_refresh: bool = Query(False, description="Force refresh tools from Pipedream")
):
    logger.info(f"Getting available Pipedream MCP tools for user: {user_id}, force_refresh: {force_refresh}")
    
    try:
        client = get_pipedream_client()
        
        # Add retry logic for better reliability
        max_retries = 3
        retry_delay = 1.0
        
        for attempt in range(max_retries):
            try:
                # Refresh rate limit token if this is a retry or forced refresh
                if attempt > 0 or force_refresh:
                    logger.info(f"Refreshing rate limit token (attempt {attempt + 1})")
                    await client.refresh_rate_limit_token()
                
                # Discover MCP servers with timeout
                mcp_servers = await client.discover_mcp_servers(
                    external_user_id=user_id
                )
                
                apps_with_tools = []
                total_tools = 0
                
                for server in mcp_servers:
                    if server.get('status') == 'connected':
                        tools = server.get('available_tools', [])
                        if tools:  # Only include apps that actually have tools
                            app_info = {
                                'app_name': server['app_name'],
                                'app_slug': server['app_slug'],
                                'tools': tools,
                                'tool_count': len(tools)
                            }
                            apps_with_tools.append(app_info)
                            total_tools += len(tools)
                            logger.info(f"Found {len(tools)} tools for {server['app_name']}")
                        else:
                            logger.warning(f"App {server['app_name']} is connected but has no tools")
                    else:
                        logger.warning(f"App {server.get('app_name', 'unknown')} has status: {server.get('status')}")
                
                logger.info(f"Successfully retrieved {len(apps_with_tools)} apps with {total_tools} total tools")
                
                return {
                    "success": True,
                    "apps": apps_with_tools,
                    "total_apps": len(apps_with_tools),
                    "total_tools": total_tools,
                    "user_id": user_id,
                    "timestamp": int(time.time())
                }
                
            except Exception as e:
                if attempt < max_retries - 1:
                    logger.warning(f"Attempt {attempt + 1} failed, retrying in {retry_delay}s: {str(e)}")
                    await asyncio.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                    continue
                else:
                    raise e
        
    except Exception as e:
        logger.error(f"Failed to get available Pipedream tools for user {user_id}: {str(e)}")
        
        # Return a more detailed error response
        error_message = str(e)
        if "MCP not available" in error_message:
            error_message = "MCP service is not available. Please check your configuration."
        elif "No connected apps" in error_message:
            error_message = "No apps are connected to your Pipedream account."
        elif "timeout" in error_message.lower():
            error_message = "Request timed out. Please try again."
        elif "rate limit" in error_message.lower():
            error_message = "Rate limit exceeded. Please wait a moment and try again."
        
        return {
            "success": False,
            "error": error_message,
            "apps": [],
            "total_apps": 0,
            "total_tools": 0,
            "user_id": user_id,
            "timestamp": int(time.time())
        }

@router.get("/apps", response_model=Dict[str, Any])
async def get_pipedream_apps(
    page: int = Query(1, ge=1),
    q: Optional[str] = Query(None),
    category: Optional[str] = Query(None)
):
    logger.info(f"Fetching Pipedream apps registry, page: {page}, search: {q}")
    
    try:
        import httpx
        
        async with httpx.AsyncClient() as client:
            url = f"https://mcp.pipedream.com/api/apps"
            params = {"page": page}
            
            if q:
                params["q"] = q
            if category:
                params["category"] = category
                
            response = await client.get(url, params=params, timeout=30.0)
            response.raise_for_status()
            
            data = response.json()
            
            logger.info(f"Successfully fetched {len(data.get('data', []))} apps from Pipedream registry")
            return {
                "success": True,
                "apps": data.get("data", []),
                "page_info": data.get("page_info", {}),
                "total_count": data.get("page_info", {}).get("total_count", 0)
            }
            
    except Exception as e:
        logger.error(f"Failed to fetch Pipedream apps: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch Pipedream apps: {str(e)}"
        )

@router.post("/profiles", response_model=PipedreamProfile)
async def create_credential_profile(
    request: CreateProfileRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Creating credential profile for user: {user_id}, app: {request.app_slug}")
    
    try:
        profile_manager = get_profile_manager(db)
        profile = await profile_manager.create_profile(user_id, request)
        
        logger.info(f"Successfully created credential profile: {profile.profile_id}")
        return profile
        
    except Exception as e:
        logger.error(f"Failed to create credential profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create credential profile: {str(e)}"
        )

@router.get("/profiles", response_model=List[PipedreamProfile])
async def get_credential_profiles(
    app_slug: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Getting credential profiles for user: {user_id}, app: {app_slug}")
    
    try:
        profile_manager = get_profile_manager(db)
        profiles = await profile_manager.get_profiles(user_id, app_slug, is_active)
        
        logger.info(f"Successfully retrieved {len(profiles)} credential profiles")
        return profiles
        
    except Exception as e:
        logger.error(f"Failed to get credential profiles: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get credential profiles: {str(e)}"
        )

@router.get("/profiles/{profile_id}", response_model=PipedreamProfile)
async def get_credential_profile(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Getting credential profile: {profile_id} for user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        profile = await profile_manager.get_profile(user_id, profile_id)
        
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        logger.info(f"Successfully retrieved credential profile: {profile_id}")
        return profile
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get credential profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get credential profile: {str(e)}"
        )

@router.put("/profiles/{profile_id}", response_model=PipedreamProfile)
async def update_credential_profile(
    profile_id: str,
    request: UpdateProfileRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Updating credential profile: {profile_id} for user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        profile = await profile_manager.update_profile(user_id, profile_id, request)
        
        logger.info(f"Successfully updated credential profile: {profile_id}")
        return profile
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to update credential profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update credential profile: {str(e)}"
        )

@router.delete("/profiles/{profile_id}")
async def delete_credential_profile(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Delete a credential profile"""
    logger.info(f"Deleting credential profile: {profile_id} for user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        deleted = await profile_manager.delete_profile(user_id, profile_id)
        
        if not deleted:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        logger.info(f"Successfully deleted credential profile: {profile_id}")
        return {"success": True, "message": "Profile deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete credential profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete credential profile: {str(e)}"
        )

@router.post("/profiles/{profile_id}/connect")
async def connect_credential_profile(
    profile_id: str,
    app: Optional[str] = Query(None),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Generate connection token for a specific credential profile"""
    logger.info(f"Connecting credential profile: {profile_id} for user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        result = await profile_manager.connect_profile(user_id, profile_id, app)
        
        logger.info(f"Successfully generated connection token for profile: {profile_id}")
        return result
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to connect credential profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect credential profile: {str(e)}"
        )

@router.get("/profiles/{profile_id}/connections")
async def get_profile_connections(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get connections for a specific credential profile"""
    logger.info(f"Getting connections for profile: {profile_id}, user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        connections = await profile_manager.get_profile_connections(user_id, profile_id)
        
        logger.info(f"Successfully retrieved {len(connections)} connections for profile: {profile_id}")
        return {
            "success": True,
            "connections": connections,
            "count": len(connections)
        }
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get profile connections: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get profile connections: {str(e)}"
        )
