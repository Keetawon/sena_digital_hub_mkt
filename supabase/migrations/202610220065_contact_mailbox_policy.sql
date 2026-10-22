-- Q76, owner decision 22 October 2026: any valid email domain is allowed.
-- Shared/company mailbox confirmation and the publication four-eyes flow remain.
-- Free webmail is an advisory UI warning, never a database/domain restriction.
-- Preserve historical domain rows and applied migration bytes; retire their command.
begin;

create or replace function hub.content_fields() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not(hub.can('projects','view') or hub.can('brands','view') or hub.can('knowledge','view')) then
  raise exception 'Permission denied' using errcode='42501'; end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(f) order by entity,section,sort,field_key),'[]') from hub.field_catalog f where status<>'retired'),
  'can_manage',hub.can_special('projects','projects.manage_field_catalog') and exists(select 1 from hub.user_account where id=hub.permission_actor() and hub_role='admin'));
end $$;

create or replace function hub.save_contact_domain(domain_name text,expected integer,next_status text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_field_admin();
 raise exception 'Mailbox domain allowlist retired; confirm each shared company mailbox instead' using errcode='23514';
end $$;

create or replace function hub.save_content_contact(kind text,ref text,contact uuid,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare prior hub.contacts; edited hub.contacts; host text; result uuid; begin
 perform hub.content_scope_access(kind,ref,'edit');
 perform pg_advisory_xact_lock(hashtextextended('contact:'||kind||':'||ref,0));
 select * into prior from hub.contacts where id=contact and scope_type=kind and scope_id=ref for update;
 if contact is not null and not found then raise exception 'Contact not found' using errcode='P0002'; end if;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Contact changed' using errcode='40001'; end if;
 if jsonb_typeof(body)<>'object' or exists(select 1 from jsonb_object_keys(body) k where k not in
  ('channel','value','url','label','shared_mailbox_confirmed','is_primary','sort','ai_exposure')) then raise exception 'Invalid contact fields' using errcode='23514'; end if;
 edited:=jsonb_populate_record(null::hub.contacts,body);
 if edited.channel is null or btrim(coalesce(edited.value,''))='' or not hub.content_locales(coalesce(edited.label,'{}'),300) then
  raise exception 'Contact channel, value and valid label required' using errcode='23514'; end if;
 if edited.channel='email' then
  if not coalesce(edited.shared_mailbox_confirmed,false) or length(edited.value)>254
   or edited.value !~ '^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then
   raise exception 'Valid email and confirmed company shared mailbox required' using errcode='23514'; end if;
  if edited.url is not null and edited.url<>'mailto:'||edited.value then raise exception 'Email URL must match mailbox' using errcode='23514'; end if;
 elsif edited.channel in ('phone','call_center_ext') then
  if edited.value !~ '^[+0-9 ()-]{2,50}$' or edited.url is not null and edited.url !~ '^tel:[+0-9-]+$' then raise exception 'Invalid telephone' using errcode='23514'; end if;
 else
  if edited.url is null or edited.url !~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' then raise exception 'HTTPS contact URL required' using errcode='23514'; end if;
  host:=lower(split_part(split_part(edited.url,'/',3),':',1));
  if edited.channel='line_oa' and host not in ('line.me','lin.ee')
   or edited.channel='facebook' and host not in ('facebook.com','www.facebook.com','fb.com')
   or edited.channel='instagram' and host not in ('instagram.com','www.instagram.com')
   or edited.channel='tiktok' and host not in ('tiktok.com','www.tiktok.com')
   or edited.channel='youtube' and host not in ('youtube.com','www.youtube.com','youtu.be')
   or edited.channel='messenger' and host not in ('m.me','messenger.com','www.messenger.com') then raise exception 'URL does not match channel' using errcode='23514'; end if;
 end if;
 result:=coalesce(contact,gen_random_uuid());
 insert into hub.contacts(id,scope_type,scope_id,channel,value,url,label,shared_mailbox_confirmed,is_primary,sort,ai_exposure)
 values(result,kind,ref,edited.channel,edited.value,edited.url,coalesce(edited.label,'{}'),coalesce(edited.shared_mailbox_confirmed,false),coalesce(edited.is_primary,false),coalesce(edited.sort,0),coalesce(edited.ai_exposure,'web_only'))
 on conflict(id) do update set channel=excluded.channel,value=excluded.value,url=excluded.url,label=excluded.label,
  shared_mailbox_confirmed=excluded.shared_mailbox_confirmed,is_primary=excluded.is_primary,sort=excluded.sort,ai_exposure=excluded.ai_exposure,revision=hub.contacts.revision+1;
 return (select to_jsonb(c) from hub.contacts c where id=result);
end $$;

revoke all on function hub.content_fields(),hub.save_contact_domain(text,integer,text),hub.save_content_contact(text,text,uuid,integer,jsonb) from public;
grant execute on function hub.content_fields(),hub.save_contact_domain(text,integer,text),hub.save_content_contact(text,text,uuid,integer,jsonb) to hub_app;

commit;
