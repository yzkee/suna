from fastapi import APIRouter, HTTPException, Depends, Request, Body, Query
from fastapi.responses import JSONResponse
from typing import List, Optional, Dict, Any, Tuple
from pydantic import BaseModel
import os
import uuid
from datetime import datetime, timezone
import json
import hmac

from core.services.supabase import DBConnection
from core.utils.auth_utils import verify_and_get_user_id_from_jwt
from core.utils.logger import logger
from core.utils.config import config
# Billing checks now handled by billing_integration.check_model_and_billing_access
from core.billing.billing_integration import billing_integration

from .trigger_service import get_trigger_service, TriggerType
from .provider_service import get_provider_service
from .execution_service import get_execution_service


from .utils import get_next_run_time, get_human_readable_schedule


# ===== ROUTERS =====

router = APIRouter(prefix="/triggers", tags=["triggers"])

# Global database connection
db: Optional[DBConnection] = None


# ===== REQUEST/RESPONSE MODELS =====

class TriggerCreateRequest(BaseModel):
    provider_id: str
    name: str
    config: Dict[str, Any]
    description: Optional[str] = None


class TriggerUpdateRequest(BaseModel):
    config: Optional[Dict[str, Any]] = None
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class TriggerResponse(BaseModel):
    trigger_id: str
    agent_id: str
    trigger_type: str
    provider_id: str
    name: str
    description: Optional[str]
    is_active: bool
    webhook_url: Optional[str]
    created_at: str
    updated_at: str
    config: Dict[str, Any]


class ProviderResponse(BaseModel):
    provider_id: str
    name: str
    description: str
    trigger_type: str
    webhook_enabled: bool
    config_schema: Dict[str, Any]


class UpcomingRun(BaseModel):
    trigger_id: str
    trigger_name: str
    trigger_type: str
    next_run_time: str
    next_run_time_local: str
    timezone: str
    cron_expression: str
    agent_prompt: Optional[str] = None
    is_active: bool
    human_readable: str


class UpcomingRunsResponse(BaseModel):
    upcoming_runs: List[UpcomingRun]
    total_count: int


def initialize(database: DBConnection):
    global db
    db = database


async def verify_and_authorize_trigger_agent_access(agent_id: str, user_id: str):
    client = await db.client
    result = await client.table('agents').select('agent_id').eq('agent_id', agent_id).eq('account_id', user_id).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Agent not found or access denied")


async def sync_triggers_to_version_config(agent_id: str):
    try:
        client = await db.client
        
        agent_result = await client.table('agents').select('current_version_id').eq('agent_id', agent_id).single().execute()
        if not agent_result.data or not agent_result.data.get('current_version_id'):
            logger.warning(f"No current version found for agent {agent_id}")
            return
        
        current_version_id = agent_result.data['current_version_id']
        
        triggers_result = await client.table('agent_triggers').select('*').eq('agent_id', agent_id).execute()
        triggers = []
        if triggers_result.data:
            import json
            for trigger in triggers_result.data:
                trigger_copy = trigger.copy()
                if 'config' in trigger_copy and isinstance(trigger_copy['config'], str):
                    try:
                        trigger_copy['config'] = json.loads(trigger_copy['config'])
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse trigger config for {trigger_copy.get('trigger_id')}")
                        trigger_copy['config'] = {}
                triggers.append(trigger_copy)
        
        version_result = await client.table('agent_versions').select('config').eq('version_id', current_version_id).single().execute()
        if not version_result.data:
            logger.warning(f"Version {current_version_id} not found")
            return
        
        config = version_result.data.get('config', {})
        
        config['triggers'] = triggers
        
        await client.table('agent_versions').update({'config': config}).eq('version_id', current_version_id).execute()
        
        logger.debug(f"Synced {len(triggers)} triggers to version config for agent {agent_id}")
        
    except Exception as e:
        logger.error(f"Failed to sync triggers to version config: {e}")


@router.get("/providers")
async def get_providers():
    
    try:
        provider_service = get_provider_service(db)
        providers = await provider_service.get_available_providers()
        
        return [ProviderResponse(**provider) for provider in providers]
        
    except Exception as e:
        logger.error(f"Error getting providers: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/agents/{agent_id}/triggers", response_model=List[TriggerResponse])
async def get_agent_triggers(
    agent_id: str,
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    
    await verify_and_authorize_trigger_agent_access(agent_id, user_id)
    
    try:
        trigger_service = get_trigger_service(db)
        triggers = await trigger_service.get_agent_triggers(agent_id)
        
        base_url = os.getenv("WEBHOOK_BASE_URL", "http://localhost:8000")
        
        responses = []
        for trigger in triggers:
            webhook_url = f"{base_url}/api/triggers/{trigger.trigger_id}/webhook"
            
            responses.append(TriggerResponse(
                trigger_id=trigger.trigger_id,
                agent_id=trigger.agent_id,
                trigger_type=trigger.trigger_type.value,
                provider_id=trigger.provider_id,
                name=trigger.name,
                description=trigger.description,
                is_active=trigger.is_active,
                webhook_url=webhook_url,
                created_at=trigger.created_at.isoformat(),
                updated_at=trigger.updated_at.isoformat(),
                config=trigger.config
            ))
        
        return responses
        
    except Exception as e:
        logger.error(f"Error getting agent triggers: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/all", response_model=List[Dict[str, Any]])
async def get_all_user_triggers(
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    try:
        client = await db.client
        
        agents_result = await client.table('agents').select(
            'agent_id, name, description, current_version_id, icon_name, icon_color, icon_background'
        ).eq('account_id', user_id).execute()
        
        if not agents_result.data:
            return []
        
        agent_info = {}
        for agent in agents_result.data:
            agent_name = agent.get('name', 'Untitled Agent')
            agent_description = agent.get('description', '')
            
            agent_info[agent['agent_id']] = {
                'agent_name': agent_name,
                'agent_description': agent_description,
                'icon_name': agent.get('icon_name'),
                'icon_color': agent.get('icon_color'),
                'icon_background': agent.get('icon_background')
            }
        
        agent_ids = [agent['agent_id'] for agent in agents_result.data]
        triggers_result = await client.table('agent_triggers').select('*').in_('agent_id', agent_ids).execute()
        
        if not triggers_result.data:
            return []
        
        base_url = os.getenv("WEBHOOK_BASE_URL", "http://localhost:8000")
        
        responses = []
        for trigger in triggers_result.data:
            agent_id = trigger['agent_id']
            webhook_url = f"{base_url}/api/triggers/{trigger['trigger_id']}/webhook"

            config = trigger.get('config', {})
            if isinstance(config, str):
                try:
                    import json
                    config = json.loads(config)
                except json.JSONDecodeError:
                    config = {}
            
            response_data = {
                'trigger_id': trigger['trigger_id'],
                'agent_id': agent_id,
                'trigger_type': trigger['trigger_type'],
                'provider_id': trigger.get('provider_id', ''),
                'name': trigger['name'],
                'description': trigger.get('description'),
                'is_active': trigger.get('is_active', False),
                'webhook_url': webhook_url,
                'created_at': trigger['created_at'],
                'updated_at': trigger['updated_at'],
                'config': config,
                'agent_name': agent_info.get(agent_id, {}).get('agent_name', 'Untitled Agent'),
                'agent_description': agent_info.get(agent_id, {}).get('agent_description', ''),
                'icon_name': agent_info.get(agent_id, {}).get('icon_name'),
                'icon_color': agent_info.get(agent_id, {}).get('icon_color'),
                'icon_background': agent_info.get(agent_id, {}).get('icon_background')
            }
            
            responses.append(response_data)
        responses.sort(key=lambda x: x['updated_at'], reverse=True)
        
        return responses
        
    except Exception as e:
        logger.error(f"Error getting all user triggers: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/agents/{agent_id}/upcoming-runs", response_model=UpcomingRunsResponse)
async def get_agent_upcoming_runs(
    agent_id: str,
    limit: int = Query(10, ge=1, le=50),
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    """Get upcoming scheduled runs for agent triggers"""
    
    await verify_and_authorize_trigger_agent_access(agent_id, user_id)
    
    try:
        trigger_service = get_trigger_service(db)
        triggers = await trigger_service.get_agent_triggers(agent_id)
        
        # Filter for active schedule triggers
        schedule_triggers = [
            trigger for trigger in triggers 
            if trigger.is_active and trigger.trigger_type == TriggerType.SCHEDULE
        ]
        
        upcoming_runs = []
        for trigger in schedule_triggers:
            config = trigger.config
            cron_expression = config.get('cron_expression')
            user_timezone = config.get('timezone', 'UTC')
            
            if not cron_expression:
                continue
                
            try:
                next_run = get_next_run_time(cron_expression, user_timezone)
                if not next_run:
                    continue
                
                import pytz
                local_tz = pytz.timezone(user_timezone)
                next_run_local = next_run.astimezone(local_tz)
                
                human_readable = get_human_readable_schedule(cron_expression, user_timezone)
                
                upcoming_runs.append(UpcomingRun(
                    trigger_id=trigger.trigger_id,
                    trigger_name=trigger.name,
                    trigger_type=trigger.trigger_type.value,
                    next_run_time=next_run.isoformat(),
                    next_run_time_local=next_run_local.isoformat(),
                    timezone=user_timezone,
                    cron_expression=cron_expression,
                    agent_prompt=config.get('agent_prompt'),
                    is_active=trigger.is_active,
                    human_readable=human_readable
                ))
                
            except Exception as e:
                logger.warning(f"Error calculating next run for trigger {trigger.trigger_id}: {e}")
                continue
        
        upcoming_runs.sort(key=lambda x: x.next_run_time)
        upcoming_runs = upcoming_runs[:limit]
        
        return UpcomingRunsResponse(
            upcoming_runs=upcoming_runs,
            total_count=len(upcoming_runs)
        )
        
    except Exception as e:
        logger.error(f"Error getting upcoming runs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/agents/{agent_id}/triggers", response_model=TriggerResponse)
async def create_agent_trigger(
    agent_id: str,
    request: TriggerCreateRequest,
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    """Create a new trigger for an agent"""
        
    await verify_and_authorize_trigger_agent_access(agent_id, user_id)
    
    try:
        trigger_service = get_trigger_service(db)
        
        trigger = await trigger_service.create_trigger(
            agent_id=agent_id,
            provider_id=request.provider_id,
            name=request.name,
            config=request.config,
            description=request.description
        )
        
        # Sync triggers to version config after creation
        await sync_triggers_to_version_config(agent_id)
        
        base_url = os.getenv("WEBHOOK_BASE_URL", "http://localhost:8000")
        webhook_url = f"{base_url}/api/triggers/{trigger.trigger_id}/webhook"
        
        return TriggerResponse(
            trigger_id=trigger.trigger_id,
            agent_id=trigger.agent_id,
            trigger_type=trigger.trigger_type.value,
            provider_id=trigger.provider_id,
            name=trigger.name,
            description=trigger.description,
            is_active=trigger.is_active,
            webhook_url=webhook_url,
            created_at=trigger.created_at.isoformat(),
            updated_at=trigger.updated_at.isoformat(),
            config=trigger.config
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating trigger: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{trigger_id}", response_model=TriggerResponse)
async def get_trigger(
    trigger_id: str,
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    """Get a trigger by ID"""
    
    try:
        trigger_service = get_trigger_service(db)
        trigger = await trigger_service.get_trigger(trigger_id)
        
        if not trigger:
            raise HTTPException(status_code=404, detail="Trigger not found")
        
        await verify_and_authorize_trigger_agent_access(trigger.agent_id, user_id)
        
        base_url = os.getenv("WEBHOOK_BASE_URL", "http://localhost:8000")
        webhook_url = f"{base_url}/api/triggers/{trigger_id}/webhook"
        
        return TriggerResponse(
            trigger_id=trigger.trigger_id,
            agent_id=trigger.agent_id,
            trigger_type=trigger.trigger_type.value,
            provider_id=trigger.provider_id,
            name=trigger.name,
            description=trigger.description,
            is_active=trigger.is_active,
            webhook_url=webhook_url,
            created_at=trigger.created_at.isoformat(),
            updated_at=trigger.updated_at.isoformat(),
            config=trigger.config
        )
        
    except Exception as e:
        logger.error(f"Error getting trigger: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/{trigger_id}", response_model=TriggerResponse)
async def update_trigger(
    trigger_id: str,
    request: TriggerUpdateRequest,
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    """Update a trigger"""
    
    try:
        trigger_service = get_trigger_service(db)
        
        trigger = await trigger_service.get_trigger(trigger_id)
        if not trigger:
            raise HTTPException(status_code=404, detail="Trigger not found")

        await verify_and_authorize_trigger_agent_access(trigger.agent_id, user_id)
        
        updated_trigger = await trigger_service.update_trigger(
            trigger_id=trigger_id,
            config=request.config,
            name=request.name,
            description=request.description,
            is_active=request.is_active
        )
        
        # Sync triggers to version config after update
        await sync_triggers_to_version_config(updated_trigger.agent_id)
        
        base_url = os.getenv("WEBHOOK_BASE_URL", "http://localhost:8000")
        webhook_url = f"{base_url}/api/triggers/{trigger_id}/webhook"

        return TriggerResponse(
            trigger_id=updated_trigger.trigger_id,
            agent_id=updated_trigger.agent_id,
            trigger_type=updated_trigger.trigger_type.value,
            provider_id=updated_trigger.provider_id,
            name=updated_trigger.name,
            description=updated_trigger.description,
            is_active=updated_trigger.is_active,
            webhook_url=webhook_url,
            created_at=updated_trigger.created_at.isoformat(),
            updated_at=updated_trigger.updated_at.isoformat(),
            config=updated_trigger.config
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating trigger: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{trigger_id}")
async def delete_trigger(
    trigger_id: str,
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    """Delete a trigger"""
    
    try:
        trigger_service = get_trigger_service(db)
        trigger = await trigger_service.get_trigger(trigger_id)
        if not trigger:
            raise HTTPException(status_code=404, detail="Trigger not found")

        await verify_and_authorize_trigger_agent_access(trigger.agent_id, user_id)
        
        # Store agent_id before deletion
        agent_id = trigger.agent_id
        
        success = await trigger_service.delete_trigger(trigger_id)
        if not success:
            raise HTTPException(status_code=404, detail="Trigger not found")
        
        # Sync triggers to version config after deletion
        await sync_triggers_to_version_config(agent_id)
        
        return {"message": "Trigger deleted successfully"}
        
    except Exception as e:
        logger.error(f"Error deleting trigger: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{trigger_id}/webhook")
async def trigger_webhook(
    trigger_id: str,
    request: Request
):
    """Handle incoming webhook for a trigger"""
    
    try:
        # Simple header-based auth using a shared secret
        # Configure the secret via environment variable: TRIGGER_WEBHOOK_SECRET
        secret = os.getenv("TRIGGER_WEBHOOK_SECRET")
        if not secret:
            logger.error("TRIGGER_WEBHOOK_SECRET is not configured")
            raise HTTPException(status_code=500, detail="Webhook secret not configured")

        incoming_secret = request.headers.get("x-trigger-secret", "")
        if not hmac.compare_digest(incoming_secret, secret):
            logger.warning(f"Invalid webhook secret for trigger {trigger_id}")
            raise HTTPException(status_code=401, detail="Unauthorized")

        # Get raw data from request
        raw_data = {}
        try:
            raw_data = await request.json()
        except:
            pass
        
        # Process trigger event
        trigger_service = get_trigger_service(db)
        result = await trigger_service.process_trigger_event(trigger_id, raw_data)
        
        if not result.success:
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": result.error_message}
            )
        
        # Execute if needed
        if result.should_execute_agent:
            trigger = await trigger_service.get_trigger(trigger_id)
            if trigger:
                logger.debug(f"Executing agent {trigger.agent_id} for trigger {trigger_id}")
                
                from .trigger_service import TriggerEvent
                event = TriggerEvent(
                    trigger_id=trigger_id,
                    agent_id=trigger.agent_id,
                    trigger_type=trigger.trigger_type,
                    raw_data=raw_data
                )
                
                execution_service = get_execution_service(db)
                execution_result = await execution_service.execute_trigger_result(
                    agent_id=trigger.agent_id,
                    trigger_result=result,
                    trigger_event=event
                )
                
                logger.debug(f"Agent execution result: {execution_result}")
                
                return JSONResponse(content={
                    "success": True,
                    "message": "Trigger processed and agent execution started",
                    "execution": execution_result,
                    "trigger_result": {
                        "should_execute_agent": result.should_execute_agent,
                        "agent_prompt": result.agent_prompt
                    }
                })
            else:
                logger.warning(f"Trigger {trigger_id} not found for execution")
        
        logger.debug(f"Webhook processed but no execution needed")
        return JSONResponse(content={
            "success": True,
            "message": "Trigger processed successfully (no execution needed)",
            "trigger_result": {
                "should_execute_agent": result.should_execute_agent
            }
        })
        
    except Exception as e:
        logger.error(f"Error processing webhook trigger: {e}")
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": "Internal server error"}
        )


