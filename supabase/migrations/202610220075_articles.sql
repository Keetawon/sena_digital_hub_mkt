-- Phase 10a: private, versioned articles. Page publication belongs to Phase 8.
begin;

create function hub.article_node_valid(node jsonb,depth integer default 0,parent text default '') returns boolean
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare kind text:=node->>'type';attrs jsonb:=coalesce(node->'attrs','{}');child jsonb;allowed text[];ref_key text;begin
 if depth>10 or jsonb_typeof(node)<>'object' or kind is null or exists(select 1 from jsonb_object_keys(node) k where k not in ('type','attrs','content','text','marks'))
  or jsonb_typeof(attrs)<>'object' then return false;end if;
 allowed:=case parent when '' then array['doc'] when 'paragraph' then array['text','hardBreak'] when 'heading' then array['text','hardBreak']
  when 'bulletList' then array['listItem'] when 'orderedList' then array['listItem'] when 'table' then array['tableRow']
  when 'tableRow' then array['tableCell','tableHeader'] when 'text' then '{}'::text[] when 'hardBreak' then '{}'::text[]
  else array['paragraph','heading','bulletList','orderedList','blockquote','table','callout','libraryImage','mediaVideo','faqEmbed','projectCard'] end;
 if not kind=any(allowed) then return false;end if;
 if kind='text' then
  if jsonb_typeof(node->'text') is distinct from 'string' or length(node->>'text')>12000 or node ? 'content' or attrs<>'{}' then return false;end if;
  if node ? 'marks' then
   if jsonb_typeof(node->'marks')<>'array' or jsonb_array_length(node->'marks')>2 then return false;end if;
   if exists(select 1 from jsonb_array_elements(node->'marks') m where m not in ('{"type":"bold"}'::jsonb,'{"type":"italic"}'::jsonb)) then return false;end if;
  end if;
  return true;
 elsif node ? 'text' or node ? 'marks' then return false;end if;
 if kind='heading' then
  if attrs-'level'<>'{}' or jsonb_typeof(attrs->'level') is distinct from 'number' or coalesce(attrs->>'level','') not in ('2','3','4') then return false;end if;
 elsif kind='orderedList' then
  if attrs-array['start','type']<>'{}' or attrs ? 'start' and jsonb_typeof(attrs->'start') is distinct from 'number'
   or coalesce(attrs->>'start','1') !~ '^[0-9]{1,5}$' or coalesce(attrs->>'type','1') not in ('1','a','A','i','I') then return false;end if;
  if coalesce((attrs->>'start')::int,1) not between 1 and 10000 then return false;end if;
 elsif kind in ('tableCell','tableHeader') then
  if attrs-array['colspan','rowspan','colwidth','align']<>'{}' or coalesce(attrs->>'align','left') not in ('left','center','right')
   or coalesce(attrs->>'colspan','1') !~ '^[0-9]{1,2}$' or coalesce(attrs->>'rowspan','1') !~ '^[0-9]{1,2}$'
   or attrs ? 'colspan' and jsonb_typeof(attrs->'colspan') is distinct from 'number' or attrs ? 'rowspan' and jsonb_typeof(attrs->'rowspan') is distinct from 'number' then return false;end if;
  if coalesce((attrs->>'colspan')::int,1) not between 1 and 10 or coalesce((attrs->>'rowspan')::int,1) not between 1 and 10 then return false;end if;
  if coalesce(attrs->'colwidth','null')<>'null' then
   if jsonb_typeof(attrs->'colwidth')<>'array' or jsonb_array_length(attrs->'colwidth')>10 then return false;end if;
   if exists(select 1 from jsonb_array_elements(attrs->'colwidth') w where jsonb_typeof(w) is distinct from 'number' or w#>>'{}' !~ '^[1-9][0-9]{0,3}$') then return false;end if;
  end if;
 elsif kind in ('libraryImage','mediaVideo') then
  ref_key:=case kind when 'libraryImage' then 'asset_id' else 'media_link_id' end;
  if attrs-ref_key<>'{}' or coalesce(attrs->>ref_key,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
 elsif kind in ('faqEmbed','projectCard') then
  if attrs-array['project_id','question_key']<>'{}' or coalesce(attrs->>'project_id','') !~ '^[A-Za-z0-9_-]{1,128}$'
   or kind='faqEmbed' and coalesce(attrs->>'question_key','') !~ '^[a-z][a-z0-9_]{1,100}$'
   or kind='projectCard' and attrs ? 'question_key' then return false;end if;
 elsif attrs<>'{}' then return false;end if;
 if kind in ('hardBreak','libraryImage','mediaVideo','faqEmbed','projectCard') then return not node ? 'content';end if;
 if jsonb_typeof(coalesce(node->'content','[]'))<>'array' then return false;end if;
 if jsonb_array_length(coalesce(node->'content','[]'))>200 then return false;end if;
 for child in select value from jsonb_array_elements(coalesce(node->'content','[]')) loop
  if not hub.article_node_valid(child,depth+1,kind) then return false;end if;
 end loop;
 return true;
end $$;
create function hub.article_nodes(doc jsonb) returns table(node jsonb,path text[])
language sql immutable set search_path=pg_catalog,pg_temp as $$
 with recursive nodes(node,path) as (
  select doc,'{}'::text[] union all
  select c.value,n.path||array['content',(c.ordinality-1)::text] from nodes n
   cross join lateral jsonb_array_elements(coalesce(n.node->'content','[]')) with ordinality c
 ) select * from nodes
$$;
create function hub.article_doc_valid(doc jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
begin
 if octet_length(doc::text)>200000 or not hub.article_node_valid(doc) then return false;end if;
 return (select count(*)<=800 from hub.article_nodes(doc));
end $$;
create function hub.article_tags_valid(tags jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
begin
 if jsonb_typeof(tags)<>'array' or jsonb_array_length(tags)>20 then return false;end if;
 return not exists(select 1 from jsonb_array_elements(tags) t where not hub.content_locales(t,100,true));
end $$;

create table hub.articles (
 id uuid primary key default gen_random_uuid(),slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
 category text not null references hub.knowledge_topics,cover_asset_id uuid references hub.assets,
 author jsonb not null default '{}' check(hub.content_locales(author,200)),tags jsonb not null default '[]' check(hub.article_tags_valid(tags)),
 state text not null default 'DRAFT' check(state in ('DRAFT','IN_REVIEW','APPROVED','RETURNED','WITHDRAWN')),
 ai_exposure text not null default 'web_only' check(ai_exposure in ('open','web_only','internal')),
 revision integer not null default 1 check(revision>0),draft_version_id uuid,approved_version_id uuid
);
create table hub.article_versions (
 id uuid primary key default gen_random_uuid(),article_id uuid not null references hub.articles,version_no integer not null check(version_no>0),
 title jsonb not null default '{}' check(hub.content_locales(title,300)),excerpt jsonb not null default '{}' check(hub.content_locales(excerpt,2000)),
 seo_title jsonb not null default '{}' check(hub.content_locales(seo_title,300)),seo_description jsonb not null default '{}' check(hub.content_locales(seo_description,1000)),
 blocks jsonb not null check(jsonb_typeof(blocks)='object' and blocks-array['th','en']='{}'
  and blocks ?& array['th','en'] and hub.article_doc_valid(blocks->'th') and hub.article_doc_valid(blocks->'en')),
 metadata jsonb not null,translations jsonb not null default '[]',
 editors uuid[] not null default '{}',state text not null default 'DRAFT' check(state in ('DRAFT','IN_REVIEW','APPROVED','RETURNED','WITHDRAWN')),
 approved_by uuid,approved_at timestamptz,unique(article_id,version_no),unique(article_id,id)
);
alter table hub.articles add foreign key(id,draft_version_id) references hub.article_versions(article_id,id),
 add foreign key(id,approved_version_id) references hub.article_versions(article_id,id);
create table hub.article_links (
 id uuid primary key default gen_random_uuid(),article_id uuid not null,version_id uuid not null,
 kind text not null check(kind in ('project','brand','programme')),ref text not null check(ref ~ '^[A-Za-z0-9_-]{1,128}$'),
 foreign key(article_id,version_id) references hub.article_versions(article_id,id),unique(version_id,kind,ref)
);
do $$ declare name text;begin
 foreach name in array array['articles','article_versions','article_links'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),
   add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
   add column updated_at timestamptz not null default clock_timestamp(),add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);execute format('alter table hub.%I force row level security',name);
  execute format('create policy article_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  execute format('create policy article_read on hub.%I for select to hub_app using(hub.can(''knowledge'',''view''))',name);
  execute format('grant select on hub.%I to hub_app',name);
  execute format('create trigger article_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  execute format('create trigger article_touch before update on hub.%I for each row execute function hub.touch_record()',name);
 end loop;
end $$;
create trigger article_immutable before update or delete on hub.article_versions for each row execute function hub.content_version_guard();
create function hub.article_link_guard() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if exists(select 1 from hub.article_versions where id=case when tg_op='DELETE' then old.version_id else new.version_id end and state<>'DRAFT')
  or tg_op='UPDATE' and exists(select 1 from hub.article_versions where id=old.version_id and state<>'DRAFT') then
  raise exception 'Submitted article links are immutable' using errcode='23514';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger article_link_immutable before insert or update or delete on hub.article_links for each row execute function hub.article_link_guard();

-- Only current, approved library images. An article never broadens asset access.
create function hub.article_image_allowed(asset uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.assets a where a.id=asset and hub.can_read_asset(a.id) and a.deleted_at is null
  and a.mime_type in ('image/jpeg','image/png','image/webp','image/gif','image/avif') and a.media_category is distinct from 'legal_document'
  and a.ai_exposure<>'internal' and a.rights_status='approved'
  and (a.effective_from is null or a.effective_from<=now()) and (a.effective_to is null or a.effective_to>now()))
$$;
create function hub.article_reference_allowed(kind text,ref text) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select case kind when 'project' then exists(select 1 from hub.projects where public_project_id=ref and deleted_at is null)
 when 'brand' then exists(select 1 from hub.brands where public_brand_id=ref and deleted_at is null)
 when 'programme' then hub.can('projects','view') and exists(select 1 from hub.project_programmes where programme_key=ref)
 else false end
$$;
create function hub.article_reference_issues(version uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare v hub.article_versions;r record;issues jsonb:='[]';bad boolean;begin
 select * into v from hub.article_versions where id=version;
 if v.metadata->>'cover_asset_id' is not null and not hub.article_image_allowed((v.metadata->>'cover_asset_id')::uuid) then
  issues:=issues||'[{"code":"cover_unavailable","label":"ภาพปกไม่มีสิทธิ์ใช้งานหรือหมดอายุ"}]';end if;
 for r in select distinct node->>'type' kind,node->'attrs' attrs from hub.article_nodes(v.blocks->'th') where node->>'type' in ('libraryImage','mediaVideo','faqEmbed','projectCard') loop
  bad:=case r.kind when 'libraryImage' then not hub.article_image_allowed((r.attrs->>'asset_id')::uuid)
   when 'mediaVideo' then not (hub.can('projects','view') and exists(select 1 from hub.media_links where id=(r.attrs->>'media_link_id')::uuid
     and state='PUBLISHED' and link_status='ok' and ai_exposure<>'internal'))
   when 'projectCard' then not (hub.can('projects','view') and exists(select 1 from hub.projects where public_project_id=r.attrs->>'project_id' and deleted_at is null))
   else not (hub.can('projects','view') and exists(select 1 from hub.projects where public_project_id=r.attrs->>'project_id' and deleted_at is null)
    and exists(select 1 from hub.faq_questions where question_key=r.attrs->>'question_key' and status='approved')) end;
  if bad then issues:=issues||jsonb_build_array(jsonb_build_object('code','reference_unavailable','label','เนื้อหาที่อ้างอิงไม่พร้อมหรือไม่มีสิทธิ์อ่าน','kind',r.kind));end if;
 end loop;
 if exists(select 1 from hub.article_links where version_id=version and not hub.article_reference_allowed(kind,ref)) then
  issues:=issues||'[{"code":"link_unavailable","label":"เนื้อหาที่เชื่อมโยงไม่พร้อมหรือไม่มีสิทธิ์อ่าน"}]';end if;
 return issues;
end $$;

-- English shares the Thai block structure. Only text leaves are translated.
create function hub.article_english_doc(source jsonb,previous jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare result jsonb:=source;children jsonb:='[]';r record;begin
 if source->>'type'='text' then return jsonb_set(source,'{text}',to_jsonb(coalesce(previous->>'text','')),true);end if;
 if source ? 'content' then
  for r in select value,ordinality from jsonb_array_elements(source->'content') with ordinality loop
   children:=children||jsonb_build_array(hub.article_english_doc(r.value,previous->'content'->(r.ordinality::int-1)));
  end loop;
  result:=jsonb_set(result,'{content}',children);
 end if;
 return result;
end $$;
create function hub.article_texts(data jsonb) returns table(field_key text,path text[],value jsonb)
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select 'article.'||key,array[key,'en'],coalesce(data->key,'{}') from unnest(array['title','excerpt','seo_title','seo_description']) key
 union all select 'article.author',array['metadata','author','en'],coalesce(data#>'{metadata,author}','{}')
 union all select 'article.tags',array['metadata','tags',(ordinality-1)::text,'en'],value
  from jsonb_array_elements(coalesce(data#>'{metadata,tags}','[]')) with ordinality
 union all select 'article.blocks',array['blocks','en']||n.path||array['text'],
  jsonb_build_object('th',n.node->>'text','en',data#>>(array['blocks','en']||n.path||array['text']))
  from hub.article_nodes(data#>'{blocks,th}') n where n.node->>'type'='text'
$$;
create function hub.track_article_translation() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare t record;begin
 if new.state<>'DRAFT' then return new;end if;
 for t in select * from hub.article_texts(to_jsonb(new)) loop
  perform hub.sync_content_translation('article',new.article_id::text||':'||array_to_string(t.path,'.'),t.field_key,'knowledge',new.article_id::text,
   jsonb_build_object('id',new.id,'article_id',new.article_id,'path',t.path),t.value);
 end loop;
 return new;
end $$;
create trigger article_translation after insert or update of title,excerpt,seo_title,seo_description,blocks,metadata on hub.article_versions
 for each row execute function hub.track_article_translation();

update hub.field_catalog set status='active',locales_required=array['th','en'],source_policy='mkt',
 validation=validation||jsonb_build_object('ai_translation',true,'max_length',case field_key when 'article.title' then 300 when 'article.excerpt' then 2000
  when 'article.seo_title' then 300 when 'article.seo_description' then 1000 when 'article.author' then 200 when 'article.tags' then 100 else 12000 end)
 where entity='article';
-- Add cases to the existing dispatchers, retaining all earlier source guards.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.translation_allowed(text)'::regprocedure);
 d:=replace(d,'select key=any(array[','select key=any(array[''article.title'',''article.excerpt'',''article.seo_title'',''article.seo_description'',''article.author'',''article.tags'',''article.blocks'',');execute d;
 d:=pg_get_functiondef('hub.translation_source_allowed(text,text)'::regprocedure);
 d:=replace(d,'select case when kind=''question''',
  'select case when kind=''article'' then exists(select 1 from hub.articles where id=split_part(owner,'':'',1)::uuid
   and category not in (''commercial_terms'',''investment_context'',''buying_process'',''programmes'')) when kind=''question''');execute d;
 d:=pg_get_functiondef('hub.translation_editable(hub.content_translations)'::regprocedure);
 d:=replace(d,'if t.owner_type=''faq'' then',
  'if t.owner_type=''article'' then return exists(select 1 from hub.article_versions v join hub.articles a on a.id=v.article_id
   cross join lateral hub.article_texts(to_jsonb(v)) x where v.id=(t.row_ref->>''id'')::uuid and v.state=''DRAFT''
   and coalesce(a.draft_version_id,v.id)=v.id and x.path=array(select jsonb_array_elements_text(t.row_ref->''path'')) and x.field_key=t.field_key);
   elsif t.owner_type=''faq'' then');execute d;
 d:=pg_get_functiondef('hub.review_content_translation(uuid,integer,integer,text)'::regprocedure);
 d:=replace(d,'if t.owner_type=''project'' then perform',
  'if t.owner_type=''article'' then
   perform 1 from hub.articles where id=(t.row_ref->>''article_id'')::uuid for update;
   perform 1 from hub.article_versions where id=(t.row_ref->>''id'')::uuid for update;
   elsif t.owner_type=''project'' then perform');
 d:=replace(d,'if t.owner_type in (''project'',''brand'',''faq'',''section'') then',
  'if t.owner_type=''article'' then
   perform hub.article_translation_write(t,english,actor);
   elsif t.owner_type in (''project'',''brand'',''faq'',''section'') then');execute d;
end $$;
create function hub.article_translation_write(t hub.content_translations,english text,actor uuid) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare data jsonb;begin
 select jsonb_set(to_jsonb(v),array(select jsonb_array_elements_text(t.row_ref->'path')),to_jsonb(english),true) into data
  from hub.article_versions v where id=(t.row_ref->>'id')::uuid;
 update hub.article_versions set title=data->'title',excerpt=data->'excerpt',seo_title=data->'seo_title',seo_description=data->'seo_description',
  blocks=data->'blocks',metadata=data->'metadata',editors=array(select distinct unnest(editors||array[actor])) where id=(t.row_ref->>'id')::uuid;
 update hub.articles set author=data#>'{metadata,author}',tags=data#>'{metadata,tags}',revision=revision+1 where id=(t.row_ref->>'article_id')::uuid;
end $$;

create function hub.article_readiness(version uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare v hub.article_versions;issues jsonb;r record;begin
 select * into v from hub.article_versions where id=version;
 issues:=hub.article_reference_issues(version);
 if btrim(coalesce(v.title->>'th',''))='' or btrim(coalesce(v.excerpt->>'th',''))=''
  or not exists(select 1 from hub.article_nodes(v.blocks->'th') where node->>'type'='text' and btrim(node->>'text')<>'') then
  issues:=issues||'[{"code":"thai_required","label":"กรอกชื่อ บทนำ และเนื้อหาภาษาไทย"}]';end if;
 for r in select * from hub.article_texts(to_jsonb(v)) where btrim(coalesce(value->>'th',''))<>'' loop
  if not exists(select 1 from hub.content_translations t where t.owner_type='article' and t.row_ref->>'id'=version::text
   and t.owner_key=v.article_id::text||':'||array_to_string(r.path,'.') and t.field_key=r.field_key
   and t.translation_state='reviewed' and t.en_from_th_version=t.th_version and t.reviewed_en=r.value->>'en') then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','english_review_required','field_key',r.field_key,'label','ตรวจทานภาษาอังกฤษให้ตรงกับต้นฉบับไทย'));exit;
  end if;
 end loop;
 return issues;
end $$;
create function hub.article_save(article uuid,expected integer,payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;a hub.articles;v hub.article_versions;version uuid;meta jsonb;doc jsonb;links jsonb;item jsonb;begin
 actor:=hub.require_permission('knowledge','edit');
 if expected is null or expected<0 or article is not null and expected=0 then raise exception 'Invalid article revision' using errcode='23514';end if;
 if jsonb_typeof(payload)<>'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in
  ('slug','category','cover_asset_id','author','tags','ai_exposure','title','excerpt','seo_title','seo_description','blocks','links')) then
  raise exception 'Invalid article fields' using errcode='23514';end if;
 if article is null then
  if expected<>0 then raise exception 'Article changed' using errcode='40001';end if;
  article:=gen_random_uuid();
  insert into hub.articles(id,slug,category) values(article,payload->>'slug',payload->>'category');
 end if;
 select * into a from hub.articles where id=article for update;
 if not found then raise exception 'Article not found' using errcode='P0002';end if;
 if expected<>0 and a.revision is distinct from expected or expected=0 and a.draft_version_id is not null then raise exception 'Article changed' using errcode='40001';end if;
 select * into v from hub.article_versions where id=a.draft_version_id for update;
 doc:=payload->'blocks';links:=coalesce(payload->'links','[]');
 if doc is null or not hub.article_doc_valid(doc) or jsonb_typeof(links)<>'array' or jsonb_array_length(links)>100 then
  raise exception 'Invalid article blocks or links' using errcode='23514';end if;
 meta:=jsonb_build_object('slug',payload->>'slug','category',payload->>'category','cover_asset_id',payload->'cover_asset_id',
  'author',coalesce(payload->'author','{}'),'tags',coalesce(payload->'tags','[]'),'ai_exposure',coalesce(payload->>'ai_exposure','web_only'));
 update hub.articles set slug=meta->>'slug',category=meta->>'category',cover_asset_id=(meta->>'cover_asset_id')::uuid,author=meta->'author',tags=meta->'tags',
  ai_exposure=meta->>'ai_exposure',state='DRAFT',revision=case when expected=0 then 1 else revision+1 end where id=article;
 version:=case when v.state='DRAFT' then v.id else gen_random_uuid() end;
 if v.id=version then
  update hub.article_versions set title=coalesce(payload->'title','{}'),excerpt=coalesce(payload->'excerpt','{}'),
   seo_title=coalesce(payload->'seo_title','{}'),seo_description=coalesce(payload->'seo_description','{}'),
   blocks=jsonb_build_object('th',doc,'en',hub.article_english_doc(doc,v.blocks->'en')),metadata=meta,
   editors=array(select distinct unnest(editors||array[actor])) where id=version;
  delete from hub.article_links where version_id=version;
 else
  insert into hub.article_versions(id,article_id,version_no,title,excerpt,seo_title,seo_description,blocks,metadata,editors)
  values(version,article,coalesce(v.version_no,0)+1,coalesce(payload->'title','{}'),coalesce(payload->'excerpt','{}'),
   coalesce(payload->'seo_title','{}'),coalesce(payload->'seo_description','{}'),jsonb_build_object('th',doc,'en',hub.article_english_doc(doc,v.blocks->'en')),meta,
   array(select distinct unnest(coalesce(v.editors,'{}')||array[actor])));
 end if;
 for item in select value from jsonb_array_elements(links) loop
  if jsonb_typeof(item)<>'object' or item-array['kind','ref']<>'{}' or not coalesce(hub.article_reference_allowed(item->>'kind',item->>'ref'),false) then
   raise exception 'Article link unavailable' using errcode='42501';end if;
  insert into hub.article_links(article_id,version_id,kind,ref) values(article,version,item->>'kind',item->>'ref');
 end loop;
 update hub.articles set draft_version_id=version where id=article;
 -- Existing inaccessible references may be retained while editing text; adding
 -- a new one requires current source access. Submit always rechecks all of them.
 if exists(select 1 from hub.article_nodes(doc) n where n.node->>'type' in ('libraryImage','mediaVideo','faqEmbed','projectCard')
  and not exists(select 1 from hub.article_nodes(coalesce(v.blocks->'th','{"type":"doc"}')) old where old.node=n.node))
  or a.cover_asset_id is distinct from (meta->>'cover_asset_id')::uuid then
  if hub.article_reference_issues(version)<>'[]' then raise exception 'Article reference unavailable or rights not approved' using errcode='42501';end if;
 end if;
 return jsonb_build_object('id',article,'version_id',version,'revision',(select revision from hub.articles where id=article));
end $$;

create function hub.article_submit(article uuid,expected integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;a hub.articles;v hub.article_versions;issues jsonb;begin
 actor:=hub.require_permission('knowledge','edit');
 select * into a from hub.articles where id=article for update;
 if not found then raise exception 'Article not found' using errcode='P0002';end if;
 if a.revision is distinct from expected then raise exception 'Article changed' using errcode='40001';end if;
 select * into v from hub.article_versions where id=a.draft_version_id for update;
 if v.state<>'DRAFT' then raise exception 'Article is not a draft' using errcode='23514';end if;
 issues:=hub.article_readiness(v.id);
 if issues<>'[]' then raise exception 'Article is not ready: %',issues using errcode='23514';end if;
 update hub.article_versions set state='IN_REVIEW',editors=array(select distinct unnest(editors||array[actor])),
  translations=coalesce((select jsonb_agg(to_jsonb(t) order by field_key,owner_key) from hub.content_translations t
   where owner_type='article' and row_ref->>'id'=v.id::text and hub.translation_editable(t)),'[]') where id=v.id;
 update hub.articles set state='IN_REVIEW',revision=revision+1 where id=article;
 return jsonb_build_object('id',article,'state','IN_REVIEW');
end $$;
create function hub.article_review(article uuid,expected integer,decision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;a hub.articles;v hub.article_versions;begin
 actor:=hub.require_permission('knowledge','approve');
 select * into a from hub.articles where id=article for update;
 if not found then raise exception 'Article not found' using errcode='P0002';end if;
 if a.revision is distinct from expected then raise exception 'Article changed' using errcode='40001';end if;
 select * into v from hub.article_versions where id=case when decision='withdraw' then a.approved_version_id else a.draft_version_id end for update;
 if actor=any(v.editors) then raise exception 'An editor cannot approve or review their own article version' using errcode='42501';end if;
 if decision is null or decision not in ('approve','return','withdraw') or v.id is null or decision in ('approve','return') and v.state<>'IN_REVIEW'
  or decision='withdraw' and v.state<>'APPROVED' then raise exception 'Invalid article review state' using errcode='23514';end if;
 if decision='approve' and hub.article_reference_issues(v.id)<>'[]' then raise exception 'Article references changed or are unavailable' using errcode='23514';end if;
 update hub.article_versions set state=case decision when 'approve' then 'APPROVED' when 'return' then 'RETURNED' else 'WITHDRAWN' end,
  approved_by=case when decision='approve' then actor else approved_by end,approved_at=case when decision='approve' then clock_timestamp() else approved_at end where id=v.id;
 update hub.articles set state=case when decision='withdraw' and draft_version_id<>v.id then state
   else case decision when 'approve' then 'APPROVED' when 'return' then 'RETURNED' else 'WITHDRAWN' end end,
  approved_version_id=case decision when 'approve' then v.id when 'withdraw' then null else approved_version_id end,revision=revision+1 where id=article;
 return jsonb_build_object('id',article,'decision',decision);
end $$;

create function hub.article_list(search text default '',page_offset integer default 0,page_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');
 if search is null or page_offset is null or page_limit is null or length(search)>120 or page_offset not between 0 and 100000 or page_limit not between 1 and 100 then raise exception 'Invalid article pagination' using errcode='23514';end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from (
  select a.id,a.slug,a.category,a.state,a.ai_exposure,a.revision,a.updated_at,v.title,v.excerpt,v.version_no from hub.articles a
  join hub.article_versions v on v.id=a.draft_version_id where search='' or a.slug ilike '%'||search||'%' or v.title::text ilike '%'||search||'%'
  order by a.updated_at desc,a.id offset page_offset limit page_limit) r),'[]'),
  'total',(select count(*) from hub.articles a join hub.article_versions v on v.id=a.draft_version_id where search='' or a.slug ilike '%'||search||'%' or v.title::text ilike '%'||search||'%'),
  'offset',page_offset,'limit',page_limit);
end $$;
create function hub.article_references() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');
 return jsonb_build_object('categories',coalesce((select jsonb_agg(jsonb_build_object('code',code,'label',label) order by code) from hub.knowledge_topics),'[]'),
  'projects',coalesce((select jsonb_agg(jsonb_build_object('ref',public_project_id,'label',public_name) order by public_project_id) from hub.projects where deleted_at is null),'[]'),
  'brands',coalesce((select jsonb_agg(jsonb_build_object('ref',public_brand_id,'label',public_name) order by public_brand_id) from hub.brands where deleted_at is null),'[]'),
  'programmes',case when hub.can('projects','view') then coalesce((select jsonb_agg(jsonb_build_object('ref',programme_key,'label',jsonb_build_object('th',programme_key)))
   from (select distinct programme_key from hub.project_programmes) p),'[]') else '[]'::jsonb end,
  'images',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,original_filename,alt_text,caption from hub.assets where hub.article_image_allowed(id) order by created_at desc,id limit 200) r),'[]'),
  'videos',case when hub.can('projects','view') then coalesce((select jsonb_agg(to_jsonb(r)) from (select id,title from hub.media_links where state='PUBLISHED' and link_status='ok' and ai_exposure<>'internal' order by created_at desc,id limit 200) r),'[]') else '[]'::jsonb end,
  'questions',case when hub.can('projects','view') then coalesce((select jsonb_agg(jsonb_build_object('question_key',question_key,'label',question_template) order by web_sort,question_key) from hub.faq_questions where status='approved'),'[]') else '[]'::jsonb end);
end $$;
create function hub.article_read(article uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.articles;begin
 perform hub.require_permission('knowledge','view');
 select * into a from hub.articles where id=article;
 if not found then raise exception 'Article not found' using errcode='P0002';end if;
 return to_jsonb(a)||jsonb_build_object('version',(select to_jsonb(v) from hub.article_versions v where id=a.draft_version_id),
  'links',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'ref',ref) order by kind,ref) from hub.article_links where version_id=a.draft_version_id),'[]'),
  'history',coalesce((select jsonb_agg(to_jsonb(r) order by version_no desc) from (select v.*,coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'ref',ref) order by kind,ref) from hub.article_links where version_id=v.id),'[]') links
   from hub.article_versions v where article_id=article order by version_no desc limit 30) r),'[]'),
  'readiness',hub.article_readiness(a.draft_version_id),'translations',hub.content_translation_list('knowledge',article::text));
end $$;
create function hub.article_preview(article uuid,locale text default 'th') returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.articles;v hub.article_versions;r record;refs jsonb:='{}';resolved jsonb;project_uuid uuid;begin
 perform hub.require_permission('knowledge','view');
 if locale not in ('th','en') or locale is null then raise exception 'Unsupported article locale' using errcode='23514';end if;
 select * into a from hub.articles where id=article;
 if not found then raise exception 'Article not found' using errcode='P0002';end if;
 select * into v from hub.article_versions where id=a.draft_version_id;
 for r in select distinct node->>'type' kind,node->'attrs' attrs from hub.article_nodes(v.blocks->locale)
  where node->>'type' in ('libraryImage','mediaVideo','faqEmbed','projectCard')
  union select 'libraryImage',jsonb_build_object('asset_id',v.metadata->>'cover_asset_id') where v.metadata->>'cover_asset_id' is not null loop
  resolved:=null;
  if r.kind='libraryImage' and hub.article_image_allowed((r.attrs->>'asset_id')::uuid) then
   select jsonb_build_object('asset_id',id,'alt',coalesce(nullif(alt_text->>locale,''),alt_text->>'th',''),
    'caption',coalesce(nullif(caption->>locale,''),caption->>'th','')) into resolved from hub.assets where id=(r.attrs->>'asset_id')::uuid;
  elsif r.kind='mediaVideo' and hub.can('projects','view') then
   select jsonb_build_object('url',url,'title',coalesce(nullif(title->>locale,''),title->>'th','')) into resolved from hub.media_links
    where id=(r.attrs->>'media_link_id')::uuid and state='PUBLISHED' and link_status='ok' and ai_exposure<>'internal';
  elsif r.kind='projectCard' and hub.can('projects','view') then
   select jsonb_build_object('public_id',public_project_id,'name',coalesce(nullif(public_name->>locale,''),public_name->>'th','')) into resolved
    from hub.projects where public_project_id=r.attrs->>'project_id' and deleted_at is null;
  elsif r.kind='faqEmbed' and hub.can('projects','view') then
   select id into project_uuid from hub.projects where public_project_id=r.attrs->>'project_id' and deleted_at is null;
   if project_uuid is not null then
    select jsonb_build_object('question',x->>'question','short_answer',x->>'short_answer','detail',x->>'detail','as_of_label',x->>'as_of_label') into resolved
     from jsonb_array_elements(hub.compose_project_faq(project_uuid,locale,null,false,false)->'items') x
     where x->>'question_key'=r.attrs->>'question_key' and x->>'state'<>'hold';
   end if;
  end if;
  refs:=refs||jsonb_build_object(r.kind||':'||coalesce(r.attrs->>'asset_id',r.attrs->>'media_link_id',r.attrs->>'project_id')||
   case when r.kind='faqEmbed' then ':'||(r.attrs->>'question_key') else '' end,resolved);
 end loop;
 return jsonb_build_object('id',a.id,'version_id',v.id,'revision',a.revision,'state',v.state,'locale',locale,
  'title',coalesce(v.title->>locale,''),'excerpt',coalesce(v.excerpt->>locale,''),'author',coalesce(v.metadata#>>array['author',locale],''),
  'cover_asset_id',v.metadata->'cover_asset_id','blocks',v.blocks->locale,'references',refs,'readiness',hub.article_readiness(v.id));
end $$;

do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub'
  and (p.proname like 'article_%' or p.proname='track_article_translation') loop
  execute format('revoke all on function %s from public',f);
 end loop;
end $$;
grant execute on function hub.article_list(text,integer,integer),hub.article_references(),hub.article_read(uuid),hub.article_preview(uuid,text),
 hub.article_save(uuid,integer,jsonb),hub.article_submit(uuid,integer),hub.article_review(uuid,integer,text) to hub_app;
comment on table hub.articles is 'Private Knowledge drafts and content approval. No article is published by these commands.';
commit;
