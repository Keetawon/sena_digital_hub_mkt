-- W9 registration/permission regressions. Metadata-only synthetic fixtures;
-- file decoding/storage/admission are API tests. Run only in the disposable runner.
begin;
select set_config('test.w9_actor',gen_random_uuid()::text,true),
 set_config('test.w9_neighbor',gen_random_uuid()::text,true);
insert into hub.user_account(id,email,status,hub_role) values
 (current_setting('test.w9_actor')::uuid,current_setting('test.w9_actor')||'@example.test','ACTIVE','viewer'),
 (current_setting('test.w9_neighbor')::uuid,current_setting('test.w9_neighbor')||'@example.test','ACTIVE','viewer');
delete from hub.account_permission where account_id in (current_setting('test.w9_actor')::uuid,current_setting('test.w9_neighbor')::uuid);
insert into hub.account_permission(account_id,tab,can_view,can_edit,can_approve) values
 (current_setting('test.w9_actor')::uuid,'knowledge',true,false,true),
 (current_setting('test.w9_neighbor')::uuid,'projects',true,true,false);
select set_config('test.w9_project',(select public_project_id from hub.projects where deleted_at is null order by public_project_id limit 1),true);
select set_config('test.w9_context',jsonb_build_object('v',1,'kind','project','ref',current_setting('test.w9_project'),'category','exterior','purpose','media')::text,true);
select set_config('test.w9_private_metadata',jsonb_build_object('original_filename','private-synthetic.jpg','mime_type','image/jpeg',
 'storage_path',repeat('1',64)||'.jpg','checksum',repeat('1',64),'file_size',100,'asset_type','image','width',10,'height',10)::text,true);
select set_config('test.w9_private_original',jsonb_build_object('checksum',repeat('1',64),'size',100,'mime_type','image/jpeg','width',10,'height',10)::text,true);
select set_config('test.w9_private_processing','{"pipeline_version":"fixture-v1","max_edge":null,"quality":null,"output_format":"jpeg","metadata_stripped":false,"pdf_images_recompressed":false,"kept_original_because_no_gain":false,"kept_unchanged_legal":true}',true);

set local role hub_app;
select set_config('app.actor_id',current_setting('test.w9_actor'),true);
do $$ declare result jsonb;resolved jsonb;begin
 assert hub.can('knowledge','approve') and not hub.can('projects','edit') and not hub.can('brands','edit');
 resolved:=hub.asset_upload_context('{"v":1,"kind":"intake"}','image/jpeg');
 assert resolved->>'processing_class'='private_exact' and resolved->'coordinates'='null'::jsonb;
 begin perform hub.asset_upload_context(current_setting('test.w9_context')::jsonb,'image/jpeg');
  raise exception 'Knowledge A became Projects E';exception when insufficient_privilege then null;end;
 begin perform hub.asset_upload_context('{"v":1,"kind":"intake","actor_id":"forged"}','image/jpeg');
  raise exception 'Forged context accepted';exception when check_violation then null;end;
 begin perform hub.asset_upload_context('{"v":1,"kind":"intake"}','image/svg+xml');
  raise exception 'Private SVG changed legal bytes';exception when check_violation then null;end;
 begin perform hub.asset_upload_resolve_context('{"v":1,"kind":"intake"}','upload','image/jpeg');
  raise exception 'Private resolver exposed';exception when insufficient_privilege then null;end;
 begin perform 1 from hub.asset_upload_sources;
  raise exception 'Private source table readable';exception when insufficient_privilege then null;end;
 begin insert into hub.asset_upload_evidence default values;
  raise exception 'Private evidence writable';exception when insufficient_privilege then null;end;
 begin perform hub.record_asset_upload_source(current_setting('test.w9_private_metadata')::jsonb||
  jsonb_build_object('checksum',repeat('b',64),'storage_path',repeat('b',64)||'.jpg'),
  current_setting('test.w9_private_original')::jsonb,current_setting('test.w9_private_processing')::jsonb,
  '{"source":"file_metadata","confirmed":false,"pipeline_version":"fixture-v1","values":{}}',
  '{"v":1,"kind":"intake"}',resolved->>'context_stamp');
  raise exception 'Private bytes identity changed';exception when check_violation then null;end;
 result:=hub.record_asset_upload_source(current_setting('test.w9_private_metadata')::jsonb,
  current_setting('test.w9_private_original')::jsonb,current_setting('test.w9_private_processing')::jsonb,
  '{"source":"file_metadata","confirmed":false,"pipeline_version":"fixture-v1","values":{}}','{"v":1,"kind":"intake"}',resolved->>'context_stamp');
 assert result->>'reuse_kind'='none' and result#>>'{upload,processing,kept_unchanged_legal}'='true';
 assert not(result->'upload'?'checksum') and not(result#>'{upload,original}'?'checksum');
 perform set_config('test.w9_private_asset',result#>>'{asset,id}',true);
 perform set_config('test.w9_private_source',result#>>'{upload,source_id}',true);
end $$;
reset role;

-- Existing global permission disjunction remains unchanged; give the same
-- synthetic actor Projects E for the authorized neighbor cases below.
insert into hub.account_permission(account_id,tab,can_view,can_edit,can_approve)
values(current_setting('test.w9_actor')::uuid,'projects',true,true,false);
select set_config('test.w9_metadata',jsonb_build_object('original_filename','optimized-synthetic.jpg','mime_type','image/jpeg',
 'storage_path',repeat('2',64)||'.jpg','checksum',repeat('2',64),'file_size',90,'asset_type','image','width',10,'height',10)::text,true);
select set_config('test.w9_original',jsonb_build_object('checksum',repeat('3',64),'size',150,'mime_type','image/jpeg','width',20,'height',10)::text,true);
select set_config('test.w9_processing','{"pipeline_version":"fixture-v1","max_edge":4096,"quality":85,"output_format":"jpeg","metadata_stripped":true,"pdf_images_recompressed":false,"kept_original_because_no_gain":false}',true);
select set_config('test.w9_suggestions','{"source":"file_metadata","confirmed":false,"pipeline_version":"extract-v1","values":{"caption":"private_file_caption_sentinel","stock":"present","stock_evidence":["stock_1"],"proximity":"unknown"}}',true);
set local role hub_app;
select set_config('app.actor_id',current_setting('test.w9_actor'),true);
do $$ declare result jsonb;again jsonb;resolved jsonb;ctx jsonb:=current_setting('test.w9_context')::jsonb;begin
 resolved:=hub.asset_upload_context(ctx,'image/jpeg');
 assert resolved->>'processing_class'='marketing_raster' and (resolved->>'input_limit')::integer=31457280;
 assert hub.find_uploaded_asset_source(repeat('3',64),'image/jpeg',ctx) is null;
 begin perform hub.record_asset_upload_source(current_setting('test.w9_metadata')::jsonb,current_setting('test.w9_original')::jsonb,
  current_setting('test.w9_processing')::jsonb,current_setting('test.w9_suggestions')::jsonb,ctx,repeat('0',64));
  raise exception 'Stale context accepted';exception when serialization_failure then null;end;
 begin perform hub.record_asset_upload_source(current_setting('test.w9_metadata')::jsonb,current_setting('test.w9_original')::jsonb,
  current_setting('test.w9_processing')::jsonb,jsonb_set(current_setting('test.w9_suggestions')::jsonb,'{values,email}','"excluded@example.test"'),
  ctx,resolved->>'context_stamp');
  raise exception 'Excluded suggestion field accepted';exception when check_violation then null;end;
 result:=hub.record_asset_upload_source(current_setting('test.w9_metadata')::jsonb,current_setting('test.w9_original')::jsonb,
  current_setting('test.w9_processing')::jsonb,current_setting('test.w9_suggestions')::jsonb,ctx,resolved->>'context_stamp');
 assert result->>'reuse_kind'='none' and result#>>'{upload,suggestions,values,caption}'='private_file_caption_sentinel';
 perform set_config('test.w9_asset',result#>>'{asset,id}',true);
 perform set_config('test.w9_source',result#>>'{upload,source_id}',true);
 perform set_config('test.w9_asset_snapshot',(result->'asset')::text,true);
 again:=hub.find_uploaded_asset_source(repeat('3',64),'image/jpeg',ctx);
 assert again->>'source_id'=result#>>'{upload,source_id}' and again->>'pipeline_version'='fixture-v1';
 -- A new encoding version may propose different stored bytes, but the final
 -- original winner keeps its bytes, identity, rights and real pipeline record.
 again:=hub.record_asset_upload_source(current_setting('test.w9_metadata')::jsonb||
  jsonb_build_object('checksum',repeat('4',64),'storage_path',repeat('4',64)||'.jpg'),
  current_setting('test.w9_original')::jsonb,current_setting('test.w9_processing')::jsonb||'{"pipeline_version":"fixture-v2"}',
  current_setting('test.w9_suggestions')::jsonb||'{"pipeline_version":"extract-v2"}',ctx,resolved->>'context_stamp');
 assert again->>'reuse_kind'='original' and again->'asset'=result->'asset';
 assert again#>>'{upload,pipeline_version}'='fixture-v1' and again#>>'{upload,extraction_version}'='extract-v2';
 -- Different source, same optimized bytes: retain both extractions; read the latest authorized owner evidence.
 ctx:=ctx||'{"purpose":"hero"}';resolved:=hub.asset_upload_context(ctx,'image/jpeg');
 again:=hub.record_asset_upload_source(current_setting('test.w9_metadata')::jsonb,
  current_setting('test.w9_original')::jsonb||jsonb_build_object('checksum',repeat('5',64)),
  current_setting('test.w9_processing')::jsonb,
  '{"source":"file_metadata","confirmed":false,"pipeline_version":"extract-v1","values":{"caption":"other_context_caption"}}',
  ctx,resolved->>'context_stamp');
 assert again->>'reuse_kind'='stored' and again#>>'{asset,id}'=result#>>'{asset,id}';
 assert again#>>'{upload,source_id}'<>result#>>'{upload,source_id}';
 assert hub.asset_upload_evidence((result#>>'{asset,id}')::uuid,current_setting('test.w9_context')::jsonb)#>>'{suggestions,values,caption}'='other_context_caption';
 assert hub.asset_upload_evidence((result#>>'{asset,id}')::uuid,ctx)#>>'{suggestions,values,caption}'='other_context_caption';
 assert hub.asset_upload_evidence((result#>>'{asset,id}')::uuid,ctx||'{"purpose":"media","category":"interior"}')#>>'{suggestions,values,caption}'='other_context_caption';
 -- A processing-class collision never relabels a private byte-exact winner.
 ctx:=current_setting('test.w9_context')::jsonb;resolved:=hub.asset_upload_context(ctx,'image/jpeg');
 begin perform hub.record_asset_upload_source(current_setting('test.w9_private_metadata')::jsonb,
  current_setting('test.w9_original')::jsonb||jsonb_build_object('checksum',repeat('6',64)),
  current_setting('test.w9_processing')::jsonb,current_setting('test.w9_suggestions')::jsonb,ctx,resolved->>'context_stamp');
  raise exception 'Private/marketing checksum collision accepted';exception when sqlstate 'P0091' then null;end;
 begin perform hub.media_save_asset(current_setting('test.w9_project'),current_setting('test.w9_private_asset')::uuid,0,
  '{"media_category":"exterior","ai_exposure":"open"}');
  raise exception 'Private provenance became public';exception when check_violation then null;end;
 begin perform hub.media_save_asset(current_setting('test.w9_project'),current_setting('test.w9_asset')::uuid,0,
  '{"media_category":"legal_document","ai_exposure":"internal"}');
  raise exception 'Optimized bytes became legal evidence';exception when check_violation then null;end;
end $$;


-- New optimized PDFs have a separate stored ceiling; legacy registration keeps 10 MiB.
do $$ declare ctx jsonb;resolved jsonb;metadata jsonb;result jsonb;begin
 ctx:=current_setting('test.w9_context')::jsonb||'{"category":"brochure","purpose":"brochure"}';
 resolved:=hub.asset_upload_context(ctx,'application/pdf');
 assert (resolved->>'input_limit')::integer=52428800 and (resolved->>'stored_limit')::integer=20971520;
 metadata:=jsonb_build_object('original_filename','synthetic-brochure.pdf','mime_type','application/pdf',
  'checksum',repeat('9',64),'storage_path',repeat('9',64)||'.pdf','file_size',15728640,'asset_type','document','width',null,'height',null);
 begin perform hub.register_uploaded_asset(metadata);
  raise exception 'Legacy stored ceiling changed';exception when check_violation then null;end;
 result:=hub.record_asset_upload_source(metadata,
  jsonb_build_object('checksum',repeat('a',64),'size',41943040,'mime_type','application/pdf','width',null,'height',null),
  '{"pipeline_version":"fixture-v1","output_format":"pdf","metadata_stripped":true,"quality":80,"pdf_dpi":200,"max_edge":null,"pdf_images_recompressed":true,"kept_original_because_no_gain":false}',
  '{"source":"file_metadata","pipeline_version":"extract-v1","confirmed":false,"values":{"caption":"synthetic PDF caption"}}',
  ctx,resolved->>'context_stamp');
 assert (result#>>'{upload,stored,size}')::integer=15728640 and result#>>'{upload,suggestions,values,proximity}'='unknown';
end $$;

-- Exercise the stored boundary through the public recorder, and retain both
-- the legacy and byte-exact private ceilings. Positive probes roll back too.
do $$ declare ctx jsonb;resolved jsonb;metadata jsonb;original jsonb;processing jsonb;result jsonb;
 suggestions jsonb:='{"source":"file_metadata","pipeline_version":"fixture-v1","confirmed":false,"values":{}}';
 checksum text;size bigint;begin
 ctx:=current_setting('test.w9_context')::jsonb||'{"category":"brochure","purpose":"brochure"}';
 resolved:=hub.asset_upload_context(ctx,'application/pdf');
 processing:='{"pipeline_version":"fixture-v1","output_format":"pdf","metadata_stripped":true,"pdf_images_recompressed":true}';
 foreach size in array array[20971520::bigint,20971521::bigint] loop
  checksum:=encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex');
  metadata:=jsonb_build_object('original_filename','boundary.pdf','mime_type','application/pdf',
   'checksum',checksum,'storage_path',checksum||'.pdf','file_size',size,'asset_type','document','width',null,'height',null);
  original:=jsonb_build_object('checksum',encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),
   'size',41943040,'mime_type','application/pdf','width',null,'height',null);
  begin
   result:=hub.record_asset_upload_source(metadata,original,processing,suggestions,ctx,resolved->>'context_stamp');
   assert size=20971520 and (result#>>'{upload,stored,size}')::bigint=size;
   raise exception 'Rollback boundary success' using errcode='P0993';
  exception when sqlstate 'P0993' then null;
   when check_violation then assert size=20971521;end;
 end loop;
 foreach size in array array[10485760::bigint,10485761::bigint] loop
  metadata:=metadata||jsonb_build_object('file_size',size);
  begin
   result:=hub.register_uploaded_asset(metadata);
   assert size=10485760 and (result#>>'{asset,file_size}')::bigint=size;
   raise exception 'Rollback legacy boundary success' using errcode='P0993';
  exception when sqlstate 'P0993' then null;
   when check_violation then assert size=10485761;end;
 end loop;
 ctx:='{"v":1,"kind":"intake"}';resolved:=hub.asset_upload_context(ctx,'application/pdf');
 foreach size in array array[10485760::bigint,10485761::bigint] loop
  metadata:=metadata||jsonb_build_object('file_size',size);
  original:=original||jsonb_build_object('checksum',metadata->>'checksum','size',size);
  begin
   result:=hub.record_asset_upload_source(metadata,original,
    '{"pipeline_version":"fixture-v1","output_format":"pdf","metadata_stripped":false,"kept_unchanged_legal":true}',
    suggestions,ctx,resolved->>'context_stamp');
   assert size=10485760 and (result#>>'{upload,stored,size}')::bigint=size;
   raise exception 'Rollback private boundary success' using errcode='P0993';
  exception when sqlstate 'P0993' then null;
   when check_violation then assert size=10485761;end;
 end loop;
end $$;

-- Owner-side writes also retain the image ceiling and the PDF upper bound.
reset role;
do $$ declare rejected_by text;begin
 begin
  insert into hub.assets(original_filename,mime_type,public_url,rights_status,file_size)
   values('table-boundary.jpg','image/jpeg','/synthetic/w9-table-boundary','pending',10485761);
  raise exception 'Image table ceiling changed';
 exception when check_violation then
  get stacked diagnostics rejected_by=constraint_name;
  assert rejected_by='assets_file_size_check';
 end;
 begin
  insert into hub.assets(original_filename,mime_type,public_url,rights_status,file_size)
   values('table-boundary.pdf','application/pdf','/synthetic/w9-table-boundary','pending',20971521);
  raise exception 'PDF table ceiling changed';
 exception when check_violation then
  get stacked diagnostics rejected_by=constraint_name;
  assert rejected_by='assets_file_size_check';
 end;
end $$;
set local role hub_app;

-- Hidden original and stored winner checks do not return source/evidence data.
select set_config('app.actor_id',current_setting('test.w9_neighbor'),true);
do $$ begin
 begin perform hub.find_uploaded_asset_source(repeat('3',64),'image/jpeg',current_setting('test.w9_context')::jsonb);
  raise exception 'Hidden dedup winner disclosed';exception when no_data_found then null;end;
 begin perform hub.asset_upload_evidence(current_setting('test.w9_asset')::uuid,current_setting('test.w9_context')::jsonb);
  raise exception 'Shared UUID disclosed private evidence';exception when no_data_found then null;end;
 assert hub.asset_upload_context(current_setting('test.w9_context')::jsonb,'image/jpeg')->>'processing_class'='marketing_raster';
end $$;

-- Preserve legacy upload and immutable historical identity, while refusing
-- to manufacture W9 provenance from an old stored-hash hit.
select set_config('app.actor_id',current_setting('test.w9_actor'),true);
do $$ declare legacy jsonb;resolved jsonb;metadata jsonb:=current_setting('test.w9_metadata')::jsonb||
 jsonb_build_object('checksum',repeat('7',64),'storage_path',repeat('7',64)||'.jpg');begin
 legacy:=hub.register_uploaded_asset(metadata);
 perform set_config('test.w9_legacy_id',legacy#>>'{asset,id}',true);
 perform set_config('test.w9_legacy_snapshot',(legacy->'asset')::text,true);
 resolved:=hub.asset_upload_context(current_setting('test.w9_context')::jsonb,'image/jpeg');
 begin perform hub.record_asset_upload_source(metadata,current_setting('test.w9_original')::jsonb||
  jsonb_build_object('checksum',repeat('8',64)),current_setting('test.w9_processing')::jsonb,
  current_setting('test.w9_suggestions')::jsonb,current_setting('test.w9_context')::jsonb,resolved->>'context_stamp');
  raise exception 'Historical stored hash was backfilled';exception when sqlstate 'P0092' then null;end;
 assert hub.asset_detail((legacy#>>'{asset,id}')::uuid)=legacy->'asset';
end $$;
reset role;
do $$ declare source hub.asset_upload_sources;evidence hub.asset_upload_evidence;event audit.change_log;
 candidate record;projection jsonb;begin
 select * into strict source from hub.asset_upload_sources where id=current_setting('test.w9_source')::uuid;
 select * into strict evidence from hub.asset_upload_evidence where source_id=source.id order by created_at desc,id desc limit 1;
 assert (select count(*) from hub.asset_upload_sources where asset_id=current_setting('test.w9_asset')::uuid)=2;
 assert not exists(select 1 from hub.asset_upload_sources where asset_id=current_setting('test.w9_legacy_id')::uuid);
 assert (select to_jsonb(a) from hub.assets a where id=current_setting('test.w9_asset')::uuid)=current_setting('test.w9_asset_snapshot')::jsonb;
 assert (select to_jsonb(a) from hub.assets a where id=current_setting('test.w9_legacy_id')::uuid)=current_setting('test.w9_legacy_snapshot')::jsonb;
 assert hub.asset_upload_has_stock(current_setting('test.w9_asset')::uuid);
 assert not exists(select 1 from hub.asset_upload_evidence e join hub.asset_upload_sources s on s.id=e.source_id
  where s.asset_id in (current_setting('test.w9_asset')::uuid,current_setting('test.w9_private_asset')::uuid)
  and (e.suggestions?'pipeline_version' or e.suggestions->'values'?'proximity'));
 assert not exists(select 1 from hub.asset_upload_sources where asset_id=current_setting('test.w9_asset')::uuid and processing?'pipeline_version');
 assert not exists(select 1 from audit.change_log where table_name in ('hub.asset_upload_sources','hub.asset_upload_evidence')
  and after_row::text like '%private_file_caption_sentinel%');
 assert hub.public_content_payload('asset',(select to_jsonb(a) from hub.assets a where id=current_setting('test.w9_private_asset')::uuid)) is null;
 assert hub.public_content_payload('asset',(select to_jsonb(a) from hub.assets a where id=current_setting('test.w9_legacy_id')::uuid)) is not null;
 -- Require real audit rows before checking the finite privacy projection.
 for candidate in
  select 'hub.asset_upload_sources' as table_name,to_jsonb(source) as row_data,
   array['id','asset_id','processing_class','pipeline_version','original_size','original_width','original_height'] as keys,
   'upload_recorded' as reason
  union all select 'hub.asset_upload_evidence',to_jsonb(evidence),
   array['id','source_id','extraction_version','proximity','stock_present','owner'],'file_evidence_extracted'
 loop
  select * into strict event from audit.change_log l
   where l.table_name=candidate.table_name and l.after_row->>'id'=candidate.row_data->>'id';
  assert event.operation='INSERT' and event.before_row is null and event.reason=candidate.reason;
  assert (select array_agg(key order by key) from jsonb_object_keys(event.after_row) k(key))=
   (select array_agg(key order by key) from unnest(candidate.keys) k(key));
  if candidate.table_name='hub.asset_upload_evidence' then
   assert event.after_row->'owner'=evidence.context-array['category','purpose','usage'];
   assert event.after_row->>'proximity'=evidence.proximity;
   assert (event.after_row->>'stock_present')::boolean;
  end if;
  assert not exists(select 1 from hub.workspace_history_contexts(candidate.table_name,candidate.row_data));
  assert not hub.content_row_visible(split_part(candidate.table_name,'.',2),candidate.row_data);
  assert not hub.workspace_history_visible(event);
 end loop;
 -- A real optimized asset still produces populated public output using only
 -- its stored identity. Private evidence must not become public metadata.
 projection:=hub.public_content_payload('asset',(select to_jsonb(a) from hub.assets a where id=source.asset_id));
 assert jsonb_typeof(projection)='object' and projection->>'mime_type'='image/jpeg';
 assert projection->>'public_asset_id'='ast_'||repeat('2',64);
 assert projection->>'public_url'='/v1/assets/ast_'||repeat('2',64)||'/file';
 assert (select array_agg(key order by key) from jsonb_object_keys(projection) k(key))=
  array['alt_text','effective_from','effective_to','mime_type','public_asset_id','public_url'];
 assert position(source.original_checksum in projection::text)=0;
 assert position(source.id::text in projection::text)=0 and position(evidence.id::text in projection::text)=0;
 assert position('private_file_caption_sentinel' in projection::text)=0 and position('proximity' in projection::text)=0;
 begin update hub.asset_upload_sources set pipeline_version='rewritten' where id=current_setting('test.w9_source')::uuid;
  raise exception 'Immutable source updated';exception when check_violation then null;end;
 begin update hub.asset_upload_evidence set proximity='far' where source_id=current_setting('test.w9_source')::uuid;
  raise exception 'Immutable evidence updated';exception when check_violation then null;end;
 -- Existing rows without provenance keep the original guard behavior.
 perform hub.require_asset_upload_use(current_setting('test.w9_legacy_id')::uuid,'public',null,true);
end $$;
-- Evidence from another project or a removed original target cannot replace
-- the latest authorized owner's evidence, including its proximity result.
insert into hub.asset_upload_evidence(source_id,context,extraction_version,proximity,suggestions,created_by)
select current_setting('test.w9_source')::uuid,context,'isolated-fixture','far',
 '{"source":"file_metadata","confirmed":false,"values":{"caption":"must_not_leak"}}',current_setting('test.w9_actor')::uuid
from (values
 (jsonb_build_object('v',1,'kind','project','project_id',gen_random_uuid(),'category','exterior','purpose','hero')),
 (jsonb_build_object('v',1,'kind','model','project_id',(select id from hub.projects where public_project_id=current_setting('test.w9_project')),'owner_id',gen_random_uuid(),'category','exterior','purpose','model_image')),
 (jsonb_build_object('v',1,'kind','brand','owner_id',gen_random_uuid(),'purpose','logo_primary')),
 (jsonb_build_object('v',1,'kind','knowledge','candidate_id',gen_random_uuid(),'category','exterior')),
 (jsonb_build_object('v',1,'kind','intake','actor_id',current_setting('test.w9_actor')::uuid))
) isolated(context);
set local role hub_app;
select set_config('app.actor_id',current_setting('test.w9_actor'),true);
do $$ declare value jsonb;begin
 value:=hub.asset_upload_evidence(current_setting('test.w9_asset')::uuid,current_setting('test.w9_context')::jsonb||'{"category":null,"purpose":"thumbnail"}');
 assert value#>>'{suggestions,values,caption}'='other_context_caption';
 assert value#>>'{suggestions,values,proximity}'='unknown';
end $$;
reset role;
-- A newer target-specific extraction is skipped when its View gate is revoked;
-- ordinary project rights evidence still supports the existing Knowledge A path.
insert into hub.asset_upload_evidence(source_id,context,extraction_version,proximity,suggestions,created_by)
select current_setting('test.w9_source')::uuid,jsonb_build_object('v',1,'kind','media_target','project_id',p.id,
 'target_type','project','target_key',p.id::text,'category','exterior','usage','gallery'),
 'target-fixture','unknown','{"source":"file_metadata","confirmed":false,"values":{"caption":"target_only"}}',current_setting('test.w9_actor')::uuid
from hub.projects p where p.public_project_id=current_setting('test.w9_project');
delete from hub.account_permission where account_id=current_setting('test.w9_actor')::uuid and tab='projects';
set local role hub_app;
select set_config('app.actor_id',current_setting('test.w9_actor'),true);
do $$ declare value jsonb;begin
 assert hub.can('knowledge','approve') and not hub.can('projects','view');
 value:=hub.asset_upload_evidence(current_setting('test.w9_asset')::uuid,current_setting('test.w9_context')::jsonb);
 assert value#>>'{suggestions,values,caption}'='other_context_caption';
 assert value#>>'{suggestions,values,proximity}'='unknown';
end $$;
reset role;

-- Brand and Knowledge reads retain their own stable object boundaries.
select set_config('test.w9_brand',(select public_brand_id from hub.brands where deleted_at is null order by public_brand_id limit 1),true),
 set_config('test.w9_candidate',gen_random_uuid()::text,true),set_config('test.w9_other_candidate',gen_random_uuid()::text,true),
 set_config('test.w9_batch',encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),true);
insert into hub.account_permission(account_id,tab,can_view,can_edit,can_approve)
values(current_setting('test.w9_actor')::uuid,'brands',true,false,false);
insert into staging.knowledge_batches(manifest_sha256,manifest) values(current_setting('test.w9_batch'),'{}');
insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence)
select candidate,current_setting('test.w9_batch'),candidate::text,'asset',
 array[(select rem_project_id from hub.projects where public_project_id=current_setting('test.w9_project'))],
 'synthetic_w9','synthetic_w9','{"validated_metadata":{"media_category":"exterior"}}'
from unnest(array[current_setting('test.w9_candidate')::uuid,current_setting('test.w9_other_candidate')::uuid]) candidate;
insert into hub.asset_upload_evidence(source_id,context,extraction_version,proximity,suggestions,created_by)
select current_setting('test.w9_source')::uuid,jsonb_build_object('v',1,'kind','brand','owner_id',id,'purpose','logo_primary'),
 'brand-fixture','unknown','{"source":"file_metadata","confirmed":false,"values":{"caption":"brand_only"}}',current_setting('test.w9_actor')::uuid
from hub.brands where public_brand_id=current_setting('test.w9_brand');
insert into hub.asset_upload_evidence(source_id,context,extraction_version,proximity,suggestions,created_by) values
(current_setting('test.w9_source')::uuid,jsonb_build_object('v',1,'kind','knowledge','candidate_id',current_setting('test.w9_candidate')),
 'knowledge-fixture','unknown','{"source":"file_metadata","confirmed":false,"values":{"caption":"candidate_only"}}',current_setting('test.w9_actor')::uuid),
(current_setting('test.w9_source')::uuid,jsonb_build_object('v',1,'kind','knowledge','candidate_id',current_setting('test.w9_other_candidate')),
 'knowledge-fixture','far','{"source":"file_metadata","confirmed":false,"values":{"caption":"other_candidate_only"}}',current_setting('test.w9_actor')::uuid),
(current_setting('test.w9_private_source')::uuid,jsonb_build_object('v',1,'kind','intake','actor_id',current_setting('test.w9_neighbor')),
 'intake-fixture','far','{"source":"file_metadata","confirmed":false,"values":{}}',current_setting('test.w9_neighbor')::uuid);
set local role hub_app;
select set_config('app.actor_id',current_setting('test.w9_actor'),true);
do $$ declare value jsonb;begin
 value:=hub.asset_upload_evidence(current_setting('test.w9_asset')::uuid,
  jsonb_build_object('v',1,'kind','brand','ref',current_setting('test.w9_brand'),'purpose','favicon'));
 assert value#>>'{suggestions,values,caption}'='brand_only';
 value:=hub.asset_upload_evidence(current_setting('test.w9_asset')::uuid,
  jsonb_build_object('v',1,'kind','knowledge','candidate_id',current_setting('test.w9_candidate')));
 assert value#>>'{suggestions,values,caption}'='candidate_only';
 assert value#>>'{suggestions,values,proximity}'='unknown';
 value:=hub.asset_upload_evidence(current_setting('test.w9_private_asset')::uuid,'{"v":1,"kind":"intake"}');
 assert value#>>'{suggestions,values,proximity}'='unknown';
end $$;
reset role;

-- Revocation is applied at each new entry, without changing retained evidence.
update hub.user_account set status='SUSPENDED' where id=current_setting('test.w9_actor')::uuid;
set local role hub_app;
select set_config('app.actor_id',current_setting('test.w9_actor'),true);
do $$ begin
 begin perform hub.asset_upload_context('{"v":1,"kind":"intake"}','image/jpeg');
  raise exception 'Suspended upload admitted';exception when insufficient_privilege then null;end;
 begin perform hub.asset_upload_evidence(current_setting('test.w9_asset')::uuid,current_setting('test.w9_context')::jsonb);
  raise exception 'Suspended evidence visible';exception when no_data_found or insufficient_privilege then null;end;
end $$;
reset role;
rollback;

