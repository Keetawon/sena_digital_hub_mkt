"""Local synthetic permission UAT; preserve existing accounts and every replay edit.

Working execution always verifies .local/postgres and takes a pg_dump first.
Disposable fixtures use the existing run marker; cleanup is disposable-only.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.auth import LOCAL_UAT_ACTORS  # noqa: E402

MARKER = 'permissions-uat-v1'
PROFILES = {
    'uat_admin': ('ผู้ดูแลสำรอง ทดสอบ', 'admin', 'ACTIVE', True),
    'uat_suspended': ('บัญชีระงับ ทดสอบ', 'viewer', 'SUSPENDED', False),
    'uat_somchai': ('สมชาย ทดสอบ', 'editor', 'ACTIVE', False),
}
SOMCHAI_TABS = {'projects': ['view', 'edit'], 'brands': ['view'],
                'promotions': ['view'], 'finance': ['view', 'edit']}


async def bna7_rows(db):
    # Inspect only the copied local rows. Source identifiers differ by snapshot;
    # no upstream connector is opened, and no source table is ever written.
    return await db.fetch("""select to_jsonb(p)::text value from staging.rem_projects p
        where exists(select 1 from jsonb_each_text(to_jsonb(p)) x where x.value='BNA7')
        order by to_jsonb(p)::text""")


async def preflight(db):
    for persona, uid in LOCAL_UAT_ACTORS.items():
        address = persona.replace('_', '-') + '@example.test'
        rows = await db.fetch('select id,email from hub.user_account where id=$1 or lower(btrim(email))=$2', uid, address)
        if any(row['id'] != uid or row['email'] != address for row in rows):
            raise ValueError('UAT_IDENTITY_CONFLICT')


async def seed(db):
    """Operator-only helper; caller must supply a verified local connection."""
    async with db.transaction():
        await db.execute("select pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0))")
        await preflight(db)
        before = await db.fetch('select id,to_jsonb(a)::text value from hub.user_account a order by id')
        ids = [r['id'] for r in before]
        permissions = await db.fetch('select to_jsonb(p)::text value from hub.account_permission p order by account_id,tab')
        acknowledgements = await db.fetch('select to_jsonb(a)::text value from hub.permission_notice_ack a order by actor_id,tab')
        bna7 = await bna7_rows(db)
        inserted = []
        for persona, uid in LOCAL_UAT_ACTORS.items():
            if uid in ids:
                continue
            name, template, status, manager = PROFILES[persona]
            await db.execute("""insert into hub.user_account(id,email,display_name_th,phone,team,
                company_type,position,requested_tasks,reason,privacy_acknowledged_at,status,hub_role,
                decision_note,decided_at) values($1,$2,$3,'020000000','ทีมทดสอบ UAT','SENA',
                'ผู้ทดสอบระบบ','{read}','ข้อมูลสังเคราะห์สำหรับทดสอบสิทธิ์ในเครื่อง',now(),$4,$5,$6,now())""",
                uid,persona.replace('_','-')+'@example.test',name,status,template,
                'บัญชีสังเคราะห์สำหรับทดสอบสถานะระงับ' if status=='SUSPENDED' else '')
            template_tabs = await db.fetchval('select tabs::text from hub.permission_template where code=$1 and version=1',template)
            if template_tabs is None:
                raise ValueError('UAT_TEMPLATE_UNAVAILABLE')
            tabs = SOMCHAI_TABS if persona=='uat_somchai' else json.loads(template_tabs)
            normal_tabs = json.loads(await db.fetchval('select hub.normalise_permission_tabs($1::jsonb)::text',json.dumps(tabs)))
            access = {'tabs':normal_tabs,'can_manage_users':manager,'template':{'code':template,'version':1},
                      'customised':persona=='uat_somchai'}
            await db.execute("select hub.write_account_access($1,$2::jsonb,null,'UAT_SEED','Synthetic local UAT profile')",uid,json.dumps(access))
            stored = await db.fetchrow("""select status,hub_role,can_manage_users,permission_template,permission_template_version,
                hub.normalise_permission_tabs(hub.permission_rows(id))::text tabs from hub.user_account where id=$1""",uid)
            if ((stored['status'],stored['hub_role'],stored['can_manage_users'],stored['permission_template'],stored['permission_template_version'])
                    != (status,template,manager,template,1) or json.loads(stored['tabs']) != normal_tabs):
                raise ValueError('UAT_TEMPLATE_COPY_FAILED')
            await db.execute("""insert into hub.user_account_event(account_id,action,new_status,new_role,decision_note)
                values($1,'UAT_SEED',$2,$3,'Synthetic local UAT profile')""",uid,status,template)
            inserted.append(persona)
        receipt = await db.fetchval('select checksum from public.local_migrations where name=$1',MARKER)
        if receipt is None:
            old_notice = await db.fetchval("select onboarding_required from hub.permission_catalog where tab='actuals'")
            if old_notice is None:
                raise ValueError('UAT_ACTUALS_UNAVAILABLE')
            # Presentation rehearsal only. No boxes/defaults/guards/ACKs change.
            await db.execute("update hub.permission_catalog set onboarding_required=true where tab='actuals'")
            await db.execute('insert into public.local_migrations(name,checksum) values($1,$2)',MARKER,
                json.dumps({'version':1,'actuals_onboarding_before':old_notice}))
        else:
            parsed = json.loads(receipt)
            if parsed.get('version') != 1 or not isinstance(parsed.get('actuals_onboarding_before'),bool):
                raise ValueError('UAT_RECEIPT_INVALID')
        after = await db.fetch('select id,to_jsonb(a)::text value from hub.user_account a where id=any($1::uuid[]) order by id',ids)
        after_permissions = await db.fetch('select to_jsonb(p)::text value from hub.account_permission p where account_id=any($1::uuid[]) order by account_id,tab',ids)
        after_ack = await db.fetch('select to_jsonb(a)::text value from hub.permission_notice_ack a order by actor_id,tab')
        if before != after or permissions != after_permissions or acknowledgements != after_ack or bna7 != await bna7_rows(db):
            raise ValueError('UAT_PRESERVATION_FAILED')
        return {'inserted':len(inserted),'preserved':len(LOCAL_UAT_ACTORS)-len(inserted),
                'existing_accounts_unchanged':len(before),'existing_permissions_unchanged':True,
                'bna7_rows_unchanged':len(bna7),'actuals_notice':'synthetic rollout rehearsal'}


async def cleanup_disposable(db):
    """Only the guarded disposable CLI/test fixture may invoke this teardown."""
    await verify_target(db,disposable=True)
    async with db.transaction():
        await db.execute("select pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0))")
        await preflight(db)
        ids = list(LOCAL_UAT_ACTORS.values())
        receipt = await db.fetchval('select checksum from public.local_migrations where name=$1',MARKER)
        if receipt is None:
            raise ValueError('UAT_RECEIPT_REQUIRED')
        previous = json.loads(receipt)
        if previous.get('version') != 1 or not isinstance(previous.get('actuals_onboarding_before'),bool):
            raise ValueError('UAT_RECEIPT_INVALID')
        await db.execute('delete from hub.permission_event where account_id=any($1::uuid[]) or actor_id=any($1::uuid[])',ids)
        await db.execute('delete from hub.user_account_event where account_id=any($1::uuid[]) or actor_id=any($1::uuid[])',ids)
        await db.execute('delete from hub.user_account where id=any($1::uuid[])',ids)
        await db.execute("update hub.permission_catalog set onboarding_required=$1 where tab='actuals'",previous['actuals_onboarding_before'])
        await db.execute('delete from public.local_migrations where name=$1',MARKER)
        return {'cleaned_synthetic_uat':True}


async def verify_target(db, disposable=False):
    actual = await db.fetchrow('select current_database() db,host(inet_server_addr()) host,inet_server_port() port')
    if (actual['db'],actual['host'],actual['port']) != ('sena_hub_local','127.0.0.1',55432):
        raise ValueError('UAT_LOCAL_TARGET_REQUIRED')
    actual_path = Path(await db.fetchval('show data_directory')).resolve()
    if disposable:
        run = Path(os.environ.get('HUB_DISPOSABLE_TEST_RUN','')).resolve()
        if not run.is_relative_to((ROOT/'.local/test-runs').resolve()) or actual_path != (run/'postgres').resolve():
            raise ValueError('UAT_DISPOSABLE_TARGET_REQUIRED')
        marker = json.loads((run/'run.json').read_text(encoding='utf-8'))
        if await db.fetchval('select run_id from public.disposable_test_run') != marker['run_id']:
            raise ValueError('UAT_DISPOSABLE_TARGET_REQUIRED')
    elif actual_path != (ROOT/'.local/postgres').resolve() or not await bna7_rows(db):
        raise ValueError('UAT_WORKING_TARGET_REQUIRED')


def working_backup(password):
    directory = ROOT/'.local/backups'/('permissions-uat-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    if not directory.resolve().is_relative_to((ROOT/'.local').resolve()):
        raise ValueError('UAT_BACKUP_PATH_INVALID')
    directory.mkdir(parents=True)
    dump = directory/'sena_hub_local.dump'
    binary = ROOT/'.local/tools/postgresql-17.11'/('pg_dump.exe' if os.name=='nt' else 'pg_dump')
    subprocess.run([str(binary),'--host=127.0.0.1','--port=55432','--username=postgres','--dbname=sena_hub_local',
                    '--no-password','--format=custom','--file='+str(dump)],
                   env={**os.environ,'PGPASSWORD':password},capture_output=True,check=True,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    with dump.open('rb') as saved:
        if saved.read(5) != b'PGDMP' or dump.stat().st_size < 1000:
            raise ValueError('UAT_BACKUP_FAILED')
    return dump


async def run(args):
    if args.cleanup and not args.disposable:
        raise ValueError('UAT_CLEANUP_DISPOSABLE_ONLY')
    if os.environ.get('HUB_ENV','local') != 'local' or os.environ.get('HUB_AUTH_MODE','demo') != 'demo':
        raise ValueError('UAT_LOCAL_MODE_REQUIRED')
    config = json.loads((ROOT/'.local/development.json').read_text(encoding='utf-8'))
    db = await asyncpg.connect(host='127.0.0.1',port=55432,database='sena_hub_local',
                              user='postgres',password=config['adminPassword'],timeout=10)
    try:
        await verify_target(db,args.disposable)
        backup = None if args.disposable else working_backup(config['adminPassword'])
        result = await cleanup_disposable(db) if args.cleanup else await seed(db)
        if backup:
            result['backup'] = str(backup.relative_to(ROOT))
            (backup.parent/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False))
    finally:
        await db.close()


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--disposable',action='store_true')
    parser.add_argument('--cleanup',action='store_true')
    try:
        asyncio.run(run(parser.parse_args()))
    except Exception as error:
        # Driver/process details can contain private connection/account fields.
        print(str(error) if isinstance(error,ValueError) and str(error).startswith('UAT_') else 'UAT_ACTION_FAILED')
        raise SystemExit(1)
