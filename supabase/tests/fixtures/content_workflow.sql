-- Test connection only. Load before suite BEGIN, then set the attested marker
-- and call pg_temp.w4_setup() as the disposable operator. No production object.
create or replace function pg_temp.w4_actor(purpose text) returns uuid
language plpgsql as $$
declare result uuid;begin
 if current_setting('app.w4_fixture_scope',true) is distinct from 'SYNTHETIC-W4-DISPOSABLE'
  or purpose not in ('author','reviewer','publisher') then raise exception 'Attested W4 fixture required';end if;
 result:=nullif(current_setting('app.w4_'||purpose,true),'')::uuid;
 if result is null then raise exception 'Initialize the W4 fixture actors first';end if;
 return result;
end $$;
create or replace function pg_temp.w4_setup(manager uuid default null) returns jsonb
language plpgsql as $$
declare original text:=current_setting('app.actor_id',true);purpose text;actor uuid;tabs jsonb;result jsonb:='{}';begin
 if current_setting('role')<>'none' or current_setting('app.w4_fixture_scope',true) is distinct from 'SYNTHETIC-W4-DISPOSABLE' then
  raise exception 'Attested disposable operator required';end if;
 if manager is null then
  select id into manager from hub.user_account where id in
   ('00000000-0000-0000-0000-000000000005','70000000-0000-0000-0000-000000000004')
   and status='ACTIVE' and hub_role='admin' order by id limit 1;
 end if;
 perform set_config('app.actor_id',manager::text,true);
 if not hub.account_admin() then raise exception 'Synthetic account manager required';end if;
 foreach purpose in array array['author','reviewer','publisher'] loop
  actor:=nullif(current_setting('app.w4_'||purpose,true),'')::uuid;
  if actor is null or not exists(select 1 from hub.user_account where id=actor and email='w4-'||purpose||'-'||actor::text||'@example.test') then
   actor:=gen_random_uuid();
   insert into hub.user_account(id,email,display_name_th,status,hub_role)
    values(actor,'w4-'||purpose||'-'||actor::text||'@example.test','Synthetic W4 '||purpose,'ACTIVE',
     case purpose when 'author' then 'editor' when 'reviewer' then 'publisher' else 'viewer' end);
   tabs:=case purpose
    when 'author' then '{"projects":["view","edit"],"brands":["view","edit"],"knowledge":["view","edit"],"promotions":["view","edit"],"releases":["view"]}'::jsonb
    when 'reviewer' then '{"projects":["view","approve"],"brands":["view","approve"],"knowledge":["view","approve"],"promotions":["view","approve"],"releases":["view"]}'::jsonb
    else '{"projects":["view"],"brands":["view"],"knowledge":["view","knowledge.publish_web"],"promotions":["view"],"releases":["view"]}'::jsonb end;
   perform hub.configure_account_access(actor,jsonb_build_object('updated_at',(select updated_at from hub.user_account where id=actor),
    'tabs',tabs,'can_manage_users',false,'note','Explicit disposable W4 fixture persona'));
   perform set_config('app.w4_'||purpose,actor::text,false);
  end if;
  result:=result||jsonb_build_object(purpose,actor);
 end loop;
 perform set_config('app.actor_id',coalesce(original,''),true);return result;
end $$;
revoke all on function pg_temp.w4_setup(uuid) from public,hub_app;

-- Positive publication fixtures opt in explicitly; approval alone must never
-- change an asset's internal/unconfirmed defaults or its existing rights.
create or replace function pg_temp.w4_confirm_media(asset uuid,category text,alt jsonb) returns void
language plpgsql as $$
declare fixture_role text:=current_setting('role');original text:=current_setting('app.actor_id',true);project_ref text;begin
 perform set_config('role','hub_app',true);
 perform set_config('app.actor_id',pg_temp.w4_actor('author')::text,true);
 select public_project_id into strict project_ref from hub.projects where rem_project_id='DEMO-001';
 perform hub.media_save_asset(project_ref,asset,(select media_revision from hub.assets where id=asset),
  jsonb_build_object('media_category',category,'metadata_state','confirmed',
   'marketing_publication',true,'ai_exposure','web_only','alt_text',alt));
 perform set_config('app.actor_id',coalesce(original,''),true);
 perform set_config('role',fixture_role,true);
end $$;

create or replace function pg_temp.w4_confirm_seed_media() returns void
language plpgsql as $$
declare fixture_role text:=current_setting('role');original text:=current_setting('app.actor_id',true);project_ref text;asset_row record;begin
 perform set_config('role','hub_app',true);
 perform set_config('app.actor_id',pg_temp.w4_actor('author')::text,true);
 select public_project_id into strict project_ref from hub.projects where rem_project_id='DEMO-001';
 for asset_row in select a.id,a.media_revision,b.alt_text from hub.assets a
  join hub.entity_assets b on b.asset_id=a.id join hub.projects p on p.id=b.project_id
  where p.rem_project_id='DEMO-001' and b.deleted_at is null and a.id in
   ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002') loop
  perform hub.media_save_asset(project_ref,asset_row.id,asset_row.media_revision,
   jsonb_build_object('media_category','exterior','metadata_state','confirmed',
    'marketing_publication',true,'ai_exposure','web_only','alt_text',asset_row.alt_text));
 end loop;
 perform set_config('app.actor_id',coalesce(original,''),true);
 perform set_config('role',fixture_role,true);
end $$;

create or replace function pg_temp.w4_approve(kind text,identity jsonb) returns jsonb
language plpgsql as $$
declare fixture_role text:=current_setting('role');original text:=current_setting('app.actor_id',true);current_item jsonb;begin
 perform set_config('role','hub_app',true);
 perform set_config('app.actor_id',pg_temp.w4_actor('author')::text,true);
 current_item:=hub.content_workflow_read(kind,identity);
 if current_item->>'state' in ('APPROVED','PUBLISHED') and not coalesce((current_item->>'needs_reapproval')::boolean,false) then
  perform set_config('app.actor_id',coalesce(original,''),true);perform set_config('role',fixture_role,true);return current_item;
 end if;
 if current_item->>'state'<>'IN_REVIEW' then
  current_item:=hub.content_workflow_submit(kind,identity,current_item->>'expected_hash');
 end if;
 perform set_config('app.actor_id',pg_temp.w4_actor('reviewer')::text,true);
 current_item:=hub.content_workflow_read(kind,identity);
 current_item:=hub.content_workflow_review(kind,identity,current_item->>'expected_hash','approve','Independent synthetic W4 fixture approval');
 assert current_item->>'state'='APPROVED' and not(current_item->>'self_approval')::boolean;
 perform set_config('app.actor_id',coalesce(original,''),true);perform set_config('role',fixture_role,true);return current_item;
end $$;

create or replace function pg_temp.w4_entity_targets(kind text,entity uuid) returns jsonb
language plpgsql as $$
declare fixture_role text:=current_setting('role');original text:=current_setting('app.actor_id',true);payload jsonb;row_data jsonb;model jsonb;ref text;result jsonb:='[]';begin
 perform set_config('role','hub_app',true);
 perform set_config('app.actor_id',pg_temp.w4_actor('author')::text,true);
 if kind='brand' then select public_brand_id into strict ref from hub.brands where id=entity;payload:=hub.brand_detail(ref);
 elsif kind='project' then select public_project_id into strict ref from hub.projects where id=entity;payload:=hub.project_detail(ref);
 else raise exception 'Only explicit project or brand fixtures';end if;
 result:=jsonb_build_array(jsonb_build_object('kind',kind,'identity',jsonb_build_object('id',entity)));
 for row_data in select a from jsonb_array_elements(coalesce(payload->'assets','[]')) a where exists(
  select 1 from jsonb_array_elements(coalesce(payload#>'{publication_preview,assets}','[]')) outgoing
   where outgoing->>'public_asset_id'='ast_'||coalesce(a->>'checksum',encode(sha256(convert_to(a->>'id','UTF8')),'hex'))
    and outgoing->>'asset_role'=a->>'asset_role' and outgoing->>'public_model_id' is not distinct from a->>'public_model_id') loop
  result:=result||jsonb_build_array(jsonb_build_object('kind','asset','identity',jsonb_build_object('id',row_data->>'id')),
   jsonb_build_object('kind',case kind when 'brand' then 'brand_asset' else 'project_asset' end,'identity',jsonb_build_object('id',row_data->>'binding_id')));
 end loop;
 if kind='project' then
  for model in select m from jsonb_array_elements(coalesce(payload->'models','[]')) m where exists(
   select 1 from jsonb_array_elements(coalesce(payload#>'{publication_preview,models}','[]')) outgoing where outgoing->>'public_model_id'=m->>'public_model_id') loop
   result:=result||jsonb_build_array(jsonb_build_object('kind','model','identity',jsonb_build_object('id',
    (select id from hub.model_types where project_id=entity and public_model_id=model->>'public_model_id'))));
   for row_data in select * from jsonb_array_elements(coalesce(model->'assets','[]')) loop
    result:=result||jsonb_build_array(jsonb_build_object('kind','asset','identity',jsonb_build_object('id',row_data->>'id')),
     jsonb_build_object('kind','project_asset','identity',jsonb_build_object('id',row_data->>'binding_id')));
   end loop;
  end loop;
  for row_data in select value from jsonb_array_elements(coalesce(payload#>'{facilities,items}','[]')) where nullif(value->>'updated_at','') is not null loop
   result:=result||jsonb_build_array(jsonb_build_object('kind','facility','identity',jsonb_build_object('project_id',entity,'facility_code',row_data->>'code')));
  end loop;
 end if;
 perform set_config('app.actor_id',coalesce(original,''),true);
 perform set_config('role',fixture_role,true);
 return (select jsonb_agg(value order by value->>'kind',value->'identity') from (select distinct value from jsonb_array_elements(result)) items);
end $$;
create or replace function pg_temp.w4_approve_entity(kind text,entity uuid) returns void
language plpgsql as $$
declare fixture_role text:=current_setting('role');item jsonb;begin
 perform set_config('role','hub_app',true);
 for item in select * from jsonb_array_elements(pg_temp.w4_entity_targets(kind,entity)) loop
  perform pg_temp.w4_approve(item->>'kind',item->'identity');
 end loop;
 perform set_config('role',fixture_role,true);
end $$;
create or replace function pg_temp.w4_publish(kind text,entity uuid,reason text,approve boolean default true) returns uuid
language plpgsql as $$
declare fixture_role text:=current_setting('role');original text:=current_setting('app.actor_id',true);result uuid;begin
 perform set_config('role','hub_app',true);
 if approve then perform pg_temp.w4_approve_entity(kind,entity);end if;
 perform set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
 if kind='project' then result:=hub.publish_project(entity,reason);
 elsif kind='brand' then result:=hub.publish_brand(entity,reason);
 else raise exception 'Only explicit project or brand fixtures';end if;
 perform set_config('app.actor_id',coalesce(original,''),true);perform set_config('role',fixture_role,true);return result;
end $$;
-- All helpers are INVOKER: probe calls retain ordinary grants/RLS. The setup
-- command alone can create/configure synthetic accounts, and stays owner-only.

create or replace function pg_temp.w4_withdraw(kind text,entity uuid,reason text) returns void
language plpgsql as $$
declare fixture_role text:=current_setting('role');original text:=current_setting('app.actor_id',true);begin
 perform set_config('role','hub_app',true);
 perform set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
 if kind='project' then perform hub.withdraw_project(entity,reason);
 elsif kind='brand' then perform hub.withdraw_brand(entity,reason);
 else raise exception 'Only explicit project or brand fixtures';end if;
 perform set_config('app.actor_id',coalesce(original,''),true);
 perform set_config('role',fixture_role,true);
end $$;
create or replace function pg_temp.w4_rollback(kind text,entity uuid,version uuid,reason text) returns void
language plpgsql as $$
declare fixture_role text:=current_setting('role');original text:=current_setting('app.actor_id',true);begin
 perform set_config('role','hub_app',true);
 perform set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
 if kind='project' then perform hub.rollback_project(entity,version,reason);
 elsif kind='brand' then perform hub.rollback_brand(entity,version,reason);
 else raise exception 'Only explicit project or brand fixtures';end if;
 perform set_config('app.actor_id',coalesce(original,''),true);
 perform set_config('role',fixture_role,true);
end $$;
create or replace function pg_temp.w4_release(members jsonb,reason text,demo boolean default false) returns jsonb
language plpgsql as $$
declare fixture_role text:=current_setting('role');original text:=current_setting('app.actor_id',true);result jsonb;begin
 perform set_config('role','hub_app',true);
 perform set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
 result:=hub.release_publish(members,reason,demo);
 perform set_config('app.actor_id',coalesce(original,''),true);perform set_config('role',fixture_role,true);return result;
end $$;
create or replace function pg_temp.w4_release_rollback(release uuid,reason text) returns jsonb
language plpgsql as $$
declare fixture_role text:=current_setting('role');original text:=current_setting('app.actor_id',true);result jsonb;begin
 perform set_config('role','hub_app',true);
 perform set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
 result:=hub.release_rollback(release,reason);
 perform set_config('app.actor_id',coalesce(original,''),true);perform set_config('role',fixture_role,true);return result;
end $$;

create or replace function pg_temp.w4_promotion(operation text,promotion uuid,body jsonb) returns jsonb
language plpgsql as $$
declare fixture_role text:=current_setting('role');original text:=current_setting('app.actor_id',true);result jsonb;begin
 perform set_config('role','hub_app',true);
 if operation not in ('publish','withdraw','rollback') then raise exception 'Only publication fixture operations';end if;
 perform set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
 result:=hub.promotion_command(operation,promotion,body);
 perform set_config('app.actor_id',coalesce(original,''),true);perform set_config('role',fixture_role,true);return result;
end $$;

-- Session-local INVOKER helpers only. Their attested fixture identities use
-- the real runtime role; no production function/account/default grant changes.
grant execute on function pg_temp.w4_actor(text),
 pg_temp.w4_confirm_media(uuid,text,jsonb),pg_temp.w4_confirm_seed_media(),
 pg_temp.w4_approve(text,jsonb),pg_temp.w4_entity_targets(text,uuid),
 pg_temp.w4_approve_entity(text,uuid),pg_temp.w4_publish(text,uuid,text,boolean),
 pg_temp.w4_withdraw(text,uuid,text),pg_temp.w4_rollback(text,uuid,uuid,text),
 pg_temp.w4_release(jsonb,text,boolean),pg_temp.w4_release_rollback(uuid,text),
 pg_temp.w4_promotion(text,uuid,jsonb) to hub_app,editor,publisher,viewer,admin;
