"""First-admin bootstrap explicitly copies boxes after role triggers are retired."""
import asyncio
import importlib.util
import json
from uuid import uuid4

import pytest

from test_permission_baseline import ROOT, disposable_operator


def test_operator_bootstrap_copies_admin_template_and_audits_without_role_trigger():
    spec = importlib.util.spec_from_file_location('hub_accounts_operator', ROOT / 'scripts/hub-accounts.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    async def check():
        db = await disposable_operator()
        transaction = db.transaction()
        await transaction.start()
        try:
            await db.execute("select pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0))")
            await db.execute('update hub.user_account set can_manage_users=false where can_manage_users')
            target = uuid4()
            email = f'bootstrap-{target}@example.test'
            await db.execute("insert into hub.user_account(id,email,status) values($1,$2,'PENDING')", target, email)
            await module.promote_admin(db, email.upper())
            account = await db.fetchrow('select * from hub.user_account where id=$1', target)
            assert account['status'] == 'ACTIVE' and account['hub_role'] == 'admin'
            assert account['can_manage_users'] and account['decision_note'] == ''
            template = await db.fetchrow("select * from hub.permission_template where code='admin' order by version desc limit 1")
            assert (account['permission_template'], account['permission_template_version']) == ('admin', template['version'])
            actual = await db.fetchval('select hub.normalise_permission_tabs(hub.permission_rows($1))', target)
            assert actual == await db.fetchval('select hub.normalise_permission_tabs($1::jsonb)', template['tabs'])
            event = await db.fetchrow("select before_value,after_value from hub.permission_event where account_id=$1 and action='BOOTSTRAP'", target)
            assert json.loads(event['before_value'])['can_manage_users'] is False
            assert json.loads(event['after_value'])['can_manage_users'] is True
            assert json.loads(event['after_value'])['note'] == 'Operator bootstrap'
            assert await db.fetchval("select count(*) from hub.user_account_event where account_id=$1 and action='BOOTSTRAP'", target) == 1
            with pytest.raises(ValueError, match='already exists'):
                await module.promote_admin(db, email)
            assert await db.fetchval("select count(*) from hub.permission_event where account_id=$1 and action='BOOTSTRAP'", target) == 1
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())
