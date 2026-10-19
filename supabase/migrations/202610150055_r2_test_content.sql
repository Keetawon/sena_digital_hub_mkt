-- R2 is a private hosted TEST content store. The logical alias contains no
-- physical bucket name or credential. Existing grants, RLS and binding checks
-- remain authoritative; local uploads cannot opt into hosted storage.
begin;

alter table hub.assets drop constraint assets_storage_bucket_check;
alter table hub.assets add constraint assets_storage_bucket_check
 check(storage_bucket in('local-originals','hub-test-assets','r2-test-content'));

do $$ declare definition text; old_guard text; new_guard text; old_bucket text;
begin
 definition:=pg_get_functiondef('hub.register_uploaded_asset(jsonb)'::regprocedure);
 old_guard:='metadata->>''storage_bucket'' is distinct from ''hub-test-assets'' or metadata->>''storage_provider'' is distinct from ''supabase''';
 new_guard:='not coalesce((metadata->>''storage_bucket'',metadata->>''storage_provider'') in ((''hub-test-assets'',''supabase''),(''r2-test-content'',''r2'')),false)';
 old_bucket:='case when hosted then ''hub-test-assets'' else ''local-originals'' end';
 if strpos(definition,old_guard)=0 or strpos(definition,old_bucket)=0
    or strpos(definition,'hub.require_asset_upload()')=0
    or strpos(definition,'hub.require_asset_access(a.id)')=0 then
  raise exception 'Unexpected upload function; review the R2 migration';
 end if;
 definition:=replace(definition,old_guard,new_guard);
 definition:=replace(definition,old_bucket,'case when hosted then metadata->>''storage_bucket'' else ''local-originals'' end');
 execute definition;
end $$;

commit;
