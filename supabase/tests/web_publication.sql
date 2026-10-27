-- Disposable-only publication projection fixtures. The direct snapshot below
-- isolates read-time filtering; command readiness/four-eyes use API tests.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ declare p hub.projects;page hub.web_pages;snapshot jsonb;version uuid;result jsonb;node jsonb;faq uuid;t record;count_before integer;begin
 select * into p from hub.projects where rem_project_id='DEMO-001' and deleted_at is null;
 assert p.id is not null,'Missing synthetic project';
 assert (select count(*)=3 from pg_class where oid in ('hub.web_pages'::regclass,'hub.web_publications'::regclass,'hub.web_changes'::regclass) and relrowsecurity and relforcerowsecurity);
 assert not has_table_privilege('hub_app','hub.web_publications','SELECT');
 assert not has_function_privilege('hub_app','hub.web_resolve(jsonb,text,boolean,boolean)','EXECUTE');
 assert not exists(select 1 from hub.account_permission where 'knowledge.publish_web'=any(special_actions)),'Migration silently granted publication';
 begin
  update hub.account_permission set special_actions=array_append(special_actions,'knowledge.publish_web')
   where account_id='00000000-0000-0000-0000-000000000001' and tab='knowledge';
  raise exception 'Editor obtained a publication special without approval';
 exception when check_violation then null;end;
 perform hub.save_project_fact(p.public_project_id,'project.common_fee','project',0,jsonb_build_object('value_number',0,'unit','THB/sqm/month','as_of',current_date,'ai_exposure','open'));
 perform hub.save_faq_question('synthetic_web_fee',0,'{"topic":"design","default_level":"project","question_template":{"th":"{project} fee?"},"answer_kind":"fact","fact_keys":["project.common_fee"],"is_core":true,"show_on_project_pages":true}');
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
 perform hub.approve_faq_question('synthetic_web_fee',1,'approved');
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
 result:=hub.save_faq(null,0,jsonb_build_object('question_key','synthetic_web_fee','scope_type','project','scope_id',p.rem_project_id,
  'applies_to_project_ids',array[p.rem_project_id],'question','{"th":"{project} fee?"}'::jsonb,'short_answer','{"th":"{project} fee {common_fee}"}'::jsonb,
  'answer_kind','fact','fact_keys',array['project.common_fee'],'ai_exposure','open'));
 faq:=(result->>'id')::uuid;
 for t in select * from hub.content_translations where owner_type='faq' and owner_key=faq::text and btrim(th_text)<>'' loop
  perform hub.review_content_translation(t.id,t.revision,t.th_version,t.th_text);end loop;
 perform hub.submit_faq(faq,(select revision from hub.faqs where id=faq));
 result:=hub.web_page_save('project:synthetic-web',0,jsonb_build_object('url','/synthetic-web','locales',array['th','en'],'project_ids',array[p.public_project_id],'ai_policy','open','max_faq_items',20));
 select * into page from hub.web_pages where page_key='project:synthetic-web';snapshot:=hub.web_compose(page);
 result:=hub.web_prepare('Verify explicit FAQ applicability');
 result:=hub.web_publication_read((result->>'id')::uuid,'th');
 assert result#>'{pages,0,resolved_applicability,0,rem_project_ids}' ? p.rem_project_id,'Staff review omitted the resolved REM phases';
 assert jsonb_array_length(hub.web_issues(snapshot))>0,'Synthetic incomplete project unexpectedly ready';
 insert into hub.entity_versions(entity_type,web_page_id,version_no,payload,content_sha256,publisher,change_reason)
 values('web_page',page.id,1,snapshot,hub.web_hash(snapshot),'00000000-0000-0000-0000-000000000002','Disposable read-filter fixture') returning id into version;
 update hub.web_pages set published_version_id=version where id=page.id;
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
 result:=hub.web_public_page(page.page_key,'th');
 assert exists(select 1 from jsonb_array_elements(result->'faq') x where x->>'question_key'='synthetic_web_fee' and x->>'short_answer' like '%0%'),'Zero fact disappeared';
 assert result::text not like '%'||p.rem_project_id||'%' and result::text not like '%'||p.id::text||'%','Internal project identifier escaped';
 assert result::text not like '%'||faq::text||'%' and not(result::text like '%dependencies%'),'Private proof escaped';
 update hub.project_facts set value_number=1 where project_id=p.id and fact_key='project.common_fee';
 result:=hub.web_public_page(page.page_key,'th');
 assert not exists(select 1 from jsonb_array_elements(result->'faq') x where x->>'question_key'='synthetic_web_fee'),'Unreviewed fact substituted';
 select occurrences into count_before from hub.content_gaps where project_id=p.rem_project_id and question_key='synthetic_web_fee';
 perform hub.web_public_page(page.page_key,'th');
 assert (select occurrences=count_before from hub.content_gaps where project_id=p.rem_project_id and question_key='synthetic_web_fee'),'Duplicate read inflated the gap';
 node:=hub.web_item('{"label":"web only"}','[]','web_only');
 assert hub.web_resolve(node,'th',false) is not null and hub.web_resolve(node,'th',true) is null;
 assert hub.web_resolve(hub.web_item('{"label":"internal"}','[]','internal'),'th',false) is null;
 assert hub.web_resolve('{"known":false,"amount":0}','th',false)='{"known":false,"amount":0}'::jsonb,'Zero or false became missing';
 assert hub.web_resolve(hub.web_item(jsonb_build_object('valid_to',current_date-1),'[]'),'th',false) is null,'Frozen expiry ignored';
 assert (hub.web_limit_faq('{"phases":[{"faq":[1,2]},{"faq":[3,4]}]}',3)).value='{"phases":[{"faq":[1,2]},{"faq":[3]}]}'::jsonb;
 node:=(hub.web_limit_faq('{"article":{"value":{"question_key":"test","question":"Q","short_answer":"A"}},"faq":[1,2]}',1)).value;
 assert jsonb_array_length(node->'faq')+case when node#>'{article,value}'='null'::jsonb then 0 else 1 end=1,'Inline FAQ ignored the page budget';
 begin update hub.entity_versions set payload='{}' where id=version;raise exception 'Frozen snapshot changed';exception when check_violation then null;end;
end $$;
rollback;
