"""Explicit disposable W4 fixture steps; no global account/default changes."""
import json
from hashlib import sha256
from pathlib import Path
from uuid import UUID

SQL = Path(__file__).resolve().parents[3] / 'supabase/tests/fixtures/content_workflow.sql'
REASON = 'Independent synthetic W4 fixture approval'


def decoded(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            pass
    return value


async def command(db, actor, query, *args):
    async with db.transaction():
        previous_role, previous_actor = await db.fetchrow(
            "select current_setting('role'),current_setting('app.actor_id',true)")
        await db.execute('SET LOCAL ROLE hub_app')
        await db.execute("select set_config('app.actor_id',$1,true)", str(actor))
        result = await db.fetchval(query, *args)
        await db.execute("select set_config('role',$1,true),set_config('app.actor_id',$2,true)",
                         previous_role, previous_actor or '')
        return decoded(result)


async def approve_item(db, ids, kind, identity, *, author='editor', reviewer='publisher'):
    target = json.dumps(identity, default=str)
    item = await command(db, ids[author], 'select hub.content_workflow_read($1,$2::text::jsonb)', kind, target)
    if item['state'] in ('APPROVED', 'PUBLISHED') and not item['needs_reapproval']:
        return item
    if item['state'] != 'IN_REVIEW':
        await command(db, ids[author], 'select hub.content_workflow_submit($1,$2::text::jsonb,$3)', kind, target, item['expected_hash'])
    return await decide_item(db, ids[reviewer], kind, identity, 'approve')


async def decide_item(db, actor, kind, identity, decision, reason=REASON):
    target = json.dumps(identity, default=str)
    item = await command(db, actor, 'select hub.content_workflow_read($1,$2::text::jsonb)', kind, target)
    return await command(db, actor, 'select hub.content_workflow_review($1,$2::text::jsonb,$3,$4,$5)',
                         kind, target, item['expected_hash'], decision, reason)


async def publication_persona(ids, role='viewer', *, operator=None):
    """Grant this test's new UUID only, through the existing manager command."""
    from test_permission_baseline import disposable_operator
    db = operator if operator is not None else await disposable_operator()
    try:
        actor = ids[role]
        directory = await command(db, ids['admin'], 'select hub.account_directory()')
        row = next((item for item in directory['items'] if item['id'] == str(actor)), None)
        assert row and row['email'] == f'{actor}@example.test', 'Not an isolated permission_accounts identity'
        tabs = {tab: ['view'] for tab in ('projects', 'brands', 'promotions', 'releases')}
        tabs['knowledge'] = ['view', 'knowledge.publish_web']
        await command(db, ids['admin'], 'select hub.configure_account_access($1,$2::text::jsonb)', actor,
                      json.dumps({'updated_at': row['updated_at'], 'tabs': tabs,
                                  'can_manage_users': False, 'note': 'Explicit disposable independent publisher'}))
    finally:
        if operator is None:
            await db.close()


async def load_sql_fixture(operator, manager=None):
    """Call only on an already attested disposable operator connection."""
    await operator.execute(SQL.read_text(encoding='utf-8'))
    await operator.execute("select set_config('app.w4_fixture_scope','SYNTHETIC-W4-DISPOSABLE',false)")
    return decoded(await operator.fetchval('select pg_temp.w4_setup($1)', manager))


async def approve_entity(db, ids, kind, entity):
    """Finite source rows actually owned by this explicit fixture entity."""
    table, ref_key = {'project': ('projects', 'public_project_id'), 'brand': ('brands', 'public_brand_id')}[kind]
    ref = await command(db, ids['editor'], f'select {ref_key} from hub.{table} where id=$1', UUID(str(entity)))
    payload = await command(db, ids['editor'], f'select hub.{kind}_detail($1)', ref)
    targets = [(kind, {'id': str(entity)})]
    def assets(rows, binding):
        for asset in rows:
            targets.extend([('asset', {'id': asset['id']}), (binding, {'id': asset['binding_id']})])
    preview = payload['publication_preview']
    selected = {(a['public_asset_id'], a['asset_role'], a.get('public_model_id')) for a in preview.get('assets', [])}
    assets([a for a in payload.get('assets', []) if ('ast_' + (a.get('checksum') or sha256(a['id'].encode()).hexdigest()), a['asset_role'], a.get('public_model_id')) in selected], 'project_asset' if kind == 'project' else 'brand_asset')
    if kind == 'project':
        for model in payload.get('models', []):
            if model['public_model_id'] not in {m['public_model_id'] for m in preview.get('models', [])}:
                continue
            identity = await command(db, ids['editor'], 'select id from hub.model_types where project_id=$1 and public_model_id=$2', UUID(str(entity)), model['public_model_id'])
            targets.append(('model', {'id': str(identity)}))
            assets(model.get('assets', []), 'project_asset')
        for item in payload.get('facilities', {}).get('items', []):
            if not item.get('updated_at'):
                continue
            targets.append(('facility', {'project_id': str(entity), 'facility_code': item.get('code', item.get('facility_code'))}))
    seen = set()
    for target_kind, identity in targets:
        key = json.dumps([target_kind, identity], sort_keys=True)
        if key not in seen:
            await approve_item(db, ids, target_kind, identity)
            seen.add(key)


async def approve_fixture_entity(ids, kind, entity):
    from test_permission_baseline import disposable_operator
    db = await disposable_operator()
    try:
        await approve_entity(db, ids, kind, entity)
    finally:
        await db.close()


async def confirm_demo_media(db, ids):
    """Explicit positive-fixture choice for the two named synthetic demo images."""
    project = await command(db, ids['editor'], "select public_project_id from hub.projects where rem_project_id='DEMO-001'")
    rows = await command(db, ids['editor'], """select jsonb_agg(jsonb_build_object(
        'id',a.id,'revision',a.media_revision,'alt',b.alt_text)) from hub.assets a
        join hub.entity_assets b on b.asset_id=a.id join hub.projects p on p.id=b.project_id
        where p.rem_project_id='DEMO-001' and b.deleted_at is null and a.id in
        ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002')""")
    assert len(rows) == 2
    for row in rows:
        await command(db, ids['editor'], 'select hub.media_save_asset($1,$2,$3,$4::text::jsonb)',
                      project, UUID(row['id']), row['revision'], json.dumps({
                          'media_category': 'exterior', 'metadata_state': 'confirmed',
                          'marketing_publication': True, 'ai_exposure': 'web_only', 'alt_text': row['alt']}))


async def confirm_fixture_demo_media(ids):
    from test_permission_baseline import disposable_operator
    db = await disposable_operator()
    try:
        await confirm_demo_media(db, ids)
    finally:
        await db.close()


async def review_fixture_translations(db, ids, tab, ref):
    reviewed = set()
    while True:
        rows = await command(db, ids['editor'], 'select hub.content_translation_list($1,$2)', tab, ref)
        row = next((item for item in rows if item['editable'] and item['th_text'].strip()
                    and item['translation_state'] != 'reviewed'), None)
        if row is None:
            return
        assert row['id'] not in reviewed
        await command(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)',
                      UUID(row['id']), row['revision'], row['th_version'], row['entered_en'] or 'Reviewed ' + row['th_text'])
        reviewed.add(row['id'])


async def complete_demo_content(db, ids, public_id):
    """Finite website readiness fixture; ordinary drafts, English and reviews."""
    project = await command(db, ids['editor'], 'select hub.project_detail($1)', public_id)
    assert project['source']['rem_project_id'] == 'DEMO-001'
    targets = []
    for field in ('project_intro', 'selling_summary', 'concept_name'):
        section = await command(db, ids['editor'], "select hub.save_content_section('project',$1,$2,0,$3::text::jsonb)",
                                public_id, 'section.' + field,
                                json.dumps({'body': {'th': 'Synthetic ' + field}, 'ai_exposure': 'web_only'}))
        targets.append(('section', {'id': section['id']}))
    for label in ('First', 'Second', 'Third'):
        point = await command(db, ids['editor'], 'select hub.save_selling_point($1,null,0,$2::text::jsonb)',
                              public_id, json.dumps({'title': {'th': label + ' synthetic point'},
                                                     'detail': {'th': label + ' synthetic detail'}}))
        targets.append(('selling_point', {'project_id': project['id'], 'point_key': point['point_key']}))
    await review_fixture_translations(db, ids, 'projects', public_id)
    for kind, identity in targets:
        await approve_item(db, ids, kind, identity)
    readiness = await command(db, ids['editor'], 'select hub.project_content_readiness($1)', public_id)
    assert readiness['ready'], readiness


async def prepare_web(db, ids, reason):
    """Approve only page configurations authored by this test's new editor."""
    # Reuse the test transaction: preparation may already hold the publication
    # account lock, so a second connection cannot change its synthetic grants.
    await publication_persona(ids, operator=db)
    pages = await command(db, ids['editor'], 'select hub.web_workspace()')
    selected = [page for page in pages['pages'] if page['created_by'] == str(ids['editor'])]
    assert selected, 'No exact page configurations belong to this fixture'
    for page in selected:
        await approve_item(db, ids, 'page_config', {'id': page['id']})
    return await command(db, ids['viewer'], 'select hub.publication_queue_prepare($1::text::jsonb,$2)',
                         json.dumps([{'system': 'web', 'page_key': page['page_key']} for page in selected]), reason)


def unit_publication_persona(monkeypatch, role='viewer', identity=None):
    """Per-test trusted lookup for a route double; no database/default changes."""
    from copy import deepcopy
    from sena_hub_api.auth import Authentication, ALL_DEMO_ACTORS
    original = Authentication.load_account

    async def lookup(self, request, claims):
        account = await original(self, request, claims)
        if str(claims['sub']) == str(ALL_DEMO_ACTORS[role]):
            account = deepcopy(account)
            if identity is not None:
                account['id'] = str(identity())
                claims['sub'] = account['id']
            account['capabilities']['special_actions']['knowledge.publish_web'] = True
        return account

    monkeypatch.setattr(Authentication, 'load_account', lookup)
