"""Small staff-only media projection, read under the caller's existing RLS."""


async def thumbnails(db):
    rows = await db.fetch('''SELECT 'brand' AS kind,b.rem_brand_id AS source_id,
        jsonb_build_object('id',a.id,'public_url',a.public_url) AS image
        FROM hub.brands b JOIN hub.brand_assets link ON link.brand_id=b.id
        JOIN hub.assets a ON a.id=link.asset_id
        WHERE b.deleted_at IS NULL AND link.deleted_at IS NULL AND a.deleted_at IS NULL
          AND link.asset_role='logo_primary' AND link.is_primary AND a.mime_type LIKE 'image/%'
        UNION ALL
        SELECT 'project',p.rem_project_id,jsonb_build_object('id',a.id,'public_url',a.public_url)
        FROM hub.projects p JOIN hub.entity_assets link ON link.project_id=p.id
        JOIN hub.assets a ON a.id=link.asset_id
        WHERE p.deleted_at IS NULL AND link.deleted_at IS NULL AND a.deleted_at IS NULL
          AND link.asset_role='thumbnail' AND link.is_primary AND link.model_id IS NULL AND a.mime_type LIKE 'image/%'
    ''')
    return {kind: {r['source_id']: r['image'] for r in rows if r['kind'] == kind} for kind in ('brand', 'project')}
