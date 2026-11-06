-- Phase 1: exercise the production projection, frozen versions and ACLs.
begin;
select pg_temp.w4_confirm_seed_media();
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('test.boundary_project',id::text,true),set_config('test.boundary_public',public_project_id,true)
 from hub.projects where rem_project_id='DEMO-001';
do $$ declare p uuid:=current_setting('test.boundary_project')::uuid; d jsonb; preview jsonb; live jsonb; version uuid; asset jsonb; model jsonb; ready jsonb;
begin
 perform hub.patch_project(p,'{"website_content":{"th":"INTERNAL WEBSITE REFERENCE"},"ad_disclaimer":{"th":"ข้อความทดสอบ","en":"Approved English disclaimer"},"meta_title":{"th":"ชื่อเรื่องทดสอบ","en":"English title"},"meta_description":{"th":"คำอธิบายทดสอบ","en":"English description"}}',
   (select updated_at from hub.projects where id=p));
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
 d:=hub.draft_payload(p);
 preview:=hub.project_detail(current_setting('test.boundary_public'))->'publication_preview';
 assert preview=hub.project_publication_preview(d),'Staff preview differs from publication projection';
 assert preview#>>'{ad_disclaimer,en}'='Approved English disclaimer' and preview#>>'{meta_title,en}'='English title'
   and preview#>>'{meta_description,en}'='English description','English fields lost';
 assert d#>>'{website_content,th}'='INTERNAL WEBSITE REFERENCE' and d?'source' and d?'id','Staff evidence lost';
 assert preview::text !~ '"(website_content|website_sources|source|source_record|id|binding_id|brand_id|brand_version_id|rem_project_id|rem_brand_id|rem_model_id|publisher|verified_by|rights_status|original_filename)"\s*:', 'Private field leaked';
 assert preview::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','Internal UUID leaked';
 assert hub.public_content_payload('project',d||'{"future_private_field":"DENY","public_name":{"th":"ไทย","en":"English","staff":"DENY"}}')
   =hub.public_content_payload('project',d||'{"public_name":{"th":"ไทย","en":"English"}}'),'Unknown keys or locale leaked';
 assert jsonb_array_length(preview->'assets')=jsonb_array_length(d->'assets'),'Legacy media disappeared';
 version:=pg_temp.w4_publish('project',p,'Phase 1 synthetic publication boundary test');
 select payload into live from public_api.read_projects() where public_project_id=current_setting('test.boundary_public');
 assert live=preview,'Review did not show the exact published payload';
 assert (hub.project_versions(p)->0#>'{payload,publication_preview}')=live,'History preview differs from public reader';
 assert (select payload from hub.entity_versions where id=version)?'website_content','Internal frozen reference removed';
 assert hub.progress_review_content(d)=hub.progress_review_content(d||'{"website_content":{"th":"REFERENCE ONLY EDIT"}}'),'Reference-only edit looks unpublished';
 assert hub.progress_review_content(d) is distinct from hub.progress_review_content(d||'{"ad_disclaimer":{"th":"PUBLIC EDIT"}}'),'Public edit was ignored';

 -- Gallery and model plans use actual accepted roles, and remain recommendations.
 asset:=d->'assets'->0; model:=d->'models'->0;
 assert asset is not null and model is not null,'Synthetic setup incomplete';
 ready:=hub.snapshot_readiness(d||jsonb_build_object('assets',(d->'assets')||jsonb_build_array(
   asset||'{"asset_role":"hero","is_primary":false}',asset||jsonb_build_object('asset_role','floor_plan','public_model_id',model->>'public_model_id'))));
 assert exists(select 1 from jsonb_array_elements(ready->'recommended') e where e->>'field'='assets.gallery' and (e->>'passed')::boolean),'Extra project image did not satisfy gallery';
 assert exists(select 1 from jsonb_array_elements(ready->'recommended') e where e->>'field' like 'models.%.plans' and (e->>'passed')::boolean),'Actual floor_plan role did not satisfy plans';
 assert ready->'required'=hub.snapshot_readiness(d)->'required','Optional media changed blockers';
 ready:=hub.snapshot_readiness(d||jsonb_build_object('assets',(d->'assets')||jsonb_build_array(
   asset||'{"asset_role":"gallery","is_primary":false}',asset||jsonb_build_object('asset_role','unit_plan','public_model_id',model->>'public_model_id'))));
 assert not exists(select 1 from jsonb_array_elements(ready->'recommended') e where (e->>'field'='assets.gallery' or e->>'field' like 'models.%.plans') and (e->>'passed')::boolean),'Unsupported media role counted';
end $$;

set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
 assert exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.boundary_public')),'Guarded consumer read denied';
 begin perform 1 from public_api.projects; assert false,'Raw project view leaked'; exception when insufficient_privilege then null; end;
 begin perform 1 from public_api.brands; assert false,'Raw brand view leaked'; exception when insufficient_privilege then null; end;
 begin perform 1 from public_api.promotions; assert false,'Raw promotion view leaked'; exception when insufficient_privilege then null; end;
 begin perform hub.public_content_payload('project','{}'); assert false,'Private helper executable'; exception when insufficient_privilege then null; end;
 begin perform hub.project_publication_preview('{}'); assert false,'Private preview executable'; exception when insufficient_privilege then null; end;
 begin perform hub.publication_review('project','{}'); assert false,'Private review executable'; exception when insufficient_privilege then null; end;
 begin perform hub.public_asset_file('ast_'||repeat('0',64)); assert false,'Private file transport executable'; exception when insufficient_privilege then null; end;
 begin perform public_api.asset_file('00000000-0000-0000-0000-000000000000'::uuid); assert false,'UUID file reader executable'; exception when insufficient_privilege then null; end;
 begin perform public_api.asset_file('ast_'||repeat('0',64)); assert false,'Unknown public file returned'; exception when no_data_found then null; end;
end $$;
rollback;
