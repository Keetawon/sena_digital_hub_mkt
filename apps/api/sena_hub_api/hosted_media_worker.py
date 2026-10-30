"""Sequential TEST images only. No R2 credential and no translation-queue access."""
from __future__ import annotations

import asyncio
import base64
from contextlib import asynccontextmanager
import json
import os
import ssl
from urllib.parse import unquote, urlsplit, urlunsplit, parse_qs
from uuid import UUID

import asyncpg

from .content_translation import TranslationError
from .image_broker import fetch_image
from .media_worker import MediaError, OpenAIImageSuggester, validate_suggestion
from .provider_budget import ProviderBudgetExceeded

PROJECT_REF = 'eqlrtevwpyboplljgowo'


async def worker_rpc(db, query, *args):
    async with db.transaction():
        await db.execute('SET LOCAL ROLE hub_media_worker')
        return await db.fetchval(query, *args)


async def image_once(db, *, configured, provider=None, fetch=fetch_image, approved_job_ids=None):
    await worker_rpc(db, 'select hub.media_worker_heartbeat($1)', configured)
    if not configured:
        return {'status': 'not_configured'}
    if await worker_rpc(db, 'select hub.media_budget_blocked()'):
        return {'status': 'budget_exhausted'}
    query = 'select hub.media_image_claim(null)' if approved_job_ids is None else 'select hub.website_media_claim($1)'
    job = await worker_rpc(db, query, *([] if approved_job_ids is None else [approved_job_ids]))
    if job is None:
        return {'status': 'idle'}
    job_id, lease = UUID(job['id']), UUID(job['lease_token'])
    owned, attempted, error, result, usage = provider is None, False, None, None, None
    try:
        # Fetch + validate BEFORE SDK construction and before the durable attempt marker.
        image = await fetch(job_id, lease)
        if provider is None:
            provider = OpenAIImageSuggester()
        if provider.model != job['model'] or len(json.dumps(job['context'], ensure_ascii=False).encode('utf8')) > 32768:
            raise MediaError('invalid_result')
        if not await worker_rpc(db, 'select hub.media_image_begin($1,$2)', job_id, lease):
            return {'status': 'superseded', 'job_id': str(job_id)}
        attempted = True
        result = validate_suggestion(await provider.suggest('data:image/jpeg;base64,' + base64.b64encode(image).decode('ascii'), job['context']), job['context'])
        usage = provider.last_usage
    except ProviderBudgetExceeded as failure:
        state = await worker_rpc(db, 'select hub.media_budget_exhausted($1,$2,$3)', job_id, lease, failure.code)
        return {'status': state, 'job_id': str(job_id)}
    except (MediaError, TranslationError) as failure:
        error = str(failure) if str(failure) in {'invalid_result','provider_error','provider_unavailable','file_unavailable'} else 'provider_error'
    except Exception:
        error = 'provider_error' if attempted else 'file_unavailable'
    finally:
        if owned and isinstance(provider, OpenAIImageSuggester):
            await provider.close()
    if not attempted:
        state = await worker_rpc(db, 'select hub.media_image_wait($1,$2)', job_id, lease)
        return {'status': state, 'error_code': error, 'job_id': str(job_id)}
    state = await worker_rpc(db, 'select hub.media_image_finish($1,$2,$3,$4,$5,$6)', job_id, lease, result, job['model'], error, usage)
    return {'status': state, 'error_code': error, 'job_id': str(job_id)}


def connection_settings():
    """Validate the existing dedicated connection without opening it."""
    raw = os.environ.get('HUB_MEDIA_WORKER_DATABASE_URL', '')
    uri = urlsplit(raw)
    direct = uri.hostname == f'db.{PROJECT_REF}.supabase.co' and unquote(uri.username or '') == 'hub_media_worker_login'
    import re
    session = re.fullmatch(r'aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com', uri.hostname or '') and unquote(uri.username or '') == f'hub_media_worker_login.{PROJECT_REF}'
    if (uri.scheme not in ('postgres','postgresql') or not (direct or session) or uri.port not in (None,5432)
            or uri.path != '/postgres' or not uri.password or uri.fragment or parse_qs(uri.query) != {'sslmode':['verify-full']}):
        raise RuntimeError('Dedicated TEST session connection required')
    ca = os.environ.get('HUB_MEDIA_DATABASE_CA_FILE')
    if not ca:
        raise RuntimeError('Existing TEST CA file required')
    context = ssl.create_default_context(cafile=ca)
    return urlunsplit(uri._replace(query='')), context


@asynccontextmanager
async def hosted_connection():
    dsn, context = connection_settings()
    db = await asyncpg.connect(dsn, ssl=context, timeout=15, command_timeout=15)
    try:
        actual = await db.fetchrow('select session_user,current_database() database')
        if actual['session_user'] != 'hub_media_worker_login' or actual['database'] != 'postgres':
            raise RuntimeError('Dedicated TEST worker login required')
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        await db.set_type_codec('json', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        yield db
    finally:
        await db.close()


async def serve():
    async with hosted_connection() as db:
        while True:
            configured = bool(os.environ.get('HUB_MEDIA_OPENAI_API_KEY', '').strip())
            result = await image_once(db, configured=configured)
            if result['status'] not in ('idle','not_configured'):
                print(json.dumps(result), flush=True)
            # No retry path exists after an attempt. Waiting image-fetch failures have zero attempts.
            await asyncio.sleep(30 if result['status'] in ('idle','queued','not_configured','budget_exhausted') else 1)
