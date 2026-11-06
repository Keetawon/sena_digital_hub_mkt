-- Disposable synthetic evidence. No provider call or publication.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ declare saved jsonb;article uuid;version uuid;item record;snapshot jsonb;reviewer uuid:='00000000-0000-0000-0000-000000000002';begin
 saved:=hub.article_save(null,0,'{"slug":"synthetic-sql-article","category":"design","title":{"th":"Synthetic title"},"excerpt":{"th":"Synthetic excerpt"},
  "author":{"th":"Synthetic author"},"tags":[{"th":"Synthetic tag"}],"blocks":{"type":"doc","content":[
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Heading"}]},
   {"type":"paragraph","content":[{"type":"text","text":"Body","marks":[{"type":"bold"},{"type":"italic"}]},{"type":"hardBreak"},{"type":"text","text":"Next line"}]},
   {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"List"}]}]}]},
   {"type":"orderedList","attrs":{"start":1},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Ordered"}]}]}]},
   {"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"Quote"}]}]},
   {"type":"callout","content":[{"type":"paragraph","content":[{"type":"text","text":"Callout"}]}]},
   {"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","attrs":{"colspan":1,"rowspan":1,"colwidth":null},"content":[{"type":"paragraph","content":[{"type":"text","text":"Header"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"Cell"}]}]}]}]}
  ]}}');
 article:=(saved->>'id')::uuid;version:=(saved->>'version_id')::uuid;
 assert (select count(*)=3 from pg_class where oid in ('hub.articles'::regclass,'hub.article_versions'::regclass,'hub.article_links'::regclass) and relrowsecurity and relforcerowsecurity),'Missing FORCE RLS';
 assert not has_table_privilege('hub_app','hub.article_versions','UPDATE'),'Unrestricted version write';
 assert not has_function_privilege('hub_app','hub.article_translation_write(hub.content_translations,text,uuid)','EXECUTE'),'Translation helper is open';
 assert not has_function_privilege('service_consumer','hub.article_read(uuid)','EXECUTE'),'Article content leaked to consumer';
 assert exists(select 1 from audit.change_log where table_name='hub.articles' and after_row->>'id'=article::text),'Missing article audit';
 assert not hub.article_doc_valid('{"type":"doc","content":[{"type":"script","text":"bad"}]}'),'Raw script accepted';
 assert not hub.article_doc_valid('{"type":"doc","content":[{"type":"libraryImage","attrs":{"src":"https://example.test/a.png"}}]}'),'Arbitrary image URL accepted';
 assert not hub.article_doc_valid('{"type":"doc","content":[{"type":"paragraph","attrs":{"style":"color:red"}}]}'),'Arbitrary style accepted';
 assert not hub.article_node_valid('{"type":"tableCell","attrs":{"colwidth":["100"]}}',1,'tableRow'),'String column width accepted';
 assert not hub.article_node_valid('{"type":"tableCell","attrs":{"colwidth":[0]}}',1,'tableRow'),'Zero column width accepted';
 assert hub.article_node_valid('{"type":"tableCell","attrs":{"colwidth":[100]}}',1,'tableRow'),'Numeric column width rejected';
 assert hub.article_node_valid('{"type":"tableCell","attrs":{"align":null}}',1,'tableRow'),'Default editor alignment rejected';
 assert hub.article_node_valid('{"type":"tableCell","attrs":{"align":"center"}}',1,'tableRow'),'Reviewed alignment rejected';
 assert not hub.article_node_valid('{"type":"tableCell","attrs":{"align":"center;position:fixed"}}',1,'tableRow'),'Arbitrary alignment style accepted';
 for item in select * from hub.content_translations where owner_type='article' and scope_id=article::text and btrim(th_text)<>'' order by field_key,owner_key loop
  -- Other leaf reviews update queue revisions, so read each current row again.
  select * into item from hub.content_translations where id=item.id;
  perform hub.review_content_translation(item.id,item.revision,item.th_version,item.th_text);
 end loop;
 assert hub.article_readiness(version)='[]','Reviewed text is not ready';
 perform hub.article_submit(article,(select revision from hub.articles where id=article));
 snapshot:=hub.article_read(article);
 assert snapshot#>>'{version,state}'='IN_REVIEW' and jsonb_array_length(snapshot#>'{version,translations}')>0,'Submission did not freeze evidence';
 begin update hub.article_versions set title='{"th":"Tampered"}' where id=version;raise exception 'Frozen body changed';exception when check_violation then null;end;
 begin insert into hub.article_links(article_id,version_id,kind,ref) values(article,version,'project','synthetic');raise exception 'Frozen links changed';exception when check_violation then null;end;
 begin delete from hub.article_versions where id=version;raise exception 'Version deleted';exception when check_violation then null;end;
 perform set_config('app.actor_id',reviewer::text,true);
 perform hub.article_review(article,(select revision from hub.articles where id=article),'approve');
 assert (select approved_version_id=version from hub.articles where id=article),'Approval pointer missing';
 assert (select state='APPROVED' from hub.article_versions where id=version),'Content not approved';
 assert to_regclass('public_api.articles') is null,'Private phase unexpectedly published articles';
 perform set_config('app.content_review_reason','Synthetic article withdrawal',true);
 perform hub.article_review(article,(select revision from hub.articles where id=article),'withdraw');
 perform set_config('app.content_review_reason','',true);
 assert (select approved_version_id is null from hub.articles where id=article),'Withdrawal retained approved pointer';
end $$;
rollback;
