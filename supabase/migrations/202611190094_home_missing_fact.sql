-- Migration 0094: Home missing-fact task projection
-- Replaces per-project/unit full FAQ composition loop in hub.workspace_home
-- with private helper hub.workspace_missing_fact_cells.
-- Rollback approach:
--   1. Replace call 'hub.workspace_missing_fact_cells(p.id,faq_scope.public_id)'
--      back to 'hub.compose_project_faq(p.id,''th'',faq_scope.public_id,false,false)' in hub.workspace_home.
--   2. Drop function hub.workspace_missing_fact_cells(uuid,text).

begin;

create or replace function hub.workspace_missing_fact_cells(project_uuid uuid, unit_public_id text)
returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare
  _p hub.projects;
  _unit_uuid uuid;
  _form text;
  _brand_ref text;
  _group_ref text;
  _today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  _cells jsonb := '[]'::jsonb;
  _winner_list jsonb := '[]'::jsonb;
  _needed_keys text[] := '{}'::text[];
  _avail_map jsonb := '{}'::jsonb;
  _key text;
  _slot jsonb;
  _missing text[];
  _q_rec jsonb;
begin
  select * into _p from hub.projects where id = project_uuid and deleted_at is null;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  if unit_public_id is not null then
    select id into _unit_uuid from hub.commercial_types
    where project_id = _p.id and public_commercial_type_id = unit_public_id and deleted_at is null;
    if not found then
      raise exception 'Unit type does not belong to this project' using errcode = 'P0002';
    end if;
  end if;

  _form := case when _unit_uuid is null then hub.faq_project_form(_p.id)
                else (select product_form from hub.commercial_types where id = _unit_uuid) end;
  _group_ref := hub.content_rem_values(_p.id)->>'group_id';
  select public_brand_id into _brand_ref from hub.brands where id = _p.brand_id and deleted_at is null;

  with latest_faqs as (
    select distinct on (f.id)
      f.id as faq_id,
      f.scope_type,
      f.scope_id,
      f.state as faq_state,
      v.id as version_id,
      v.version_no,
      v.question_key,
      v.state as version_state,
      v.fact_keys,
      v.applies_to_project_ids,
      v.applicability_rule,
      v.review_due,
      v.effective_to,
      v.ai_exposure,
      hub.faq_scope_rank(f.scope_type) as rank
    from hub.faqs f
    join hub.faq_versions v on v.faq_id = f.id
    order by f.id, v.version_no desc
  ),
  active_candidates as (
    select lf.*
    from latest_faqs lf
    where lf.faq_state <> 'WITHDRAWN'
      and lf.version_state <> 'WITHDRAWN'
      and (
        (lf.scope_type = 'unit_type' and _unit_uuid is not null and lf.scope_id = _unit_uuid::text)
        or (lf.scope_type = 'project' and lf.scope_id = _p.rem_project_id)
        or (lf.scope_type = 'project_group' and _group_ref is not null and lf.scope_id = _group_ref)
        or (lf.scope_type = 'programme')
        or (lf.scope_type = 'brand' and _brand_ref is not null and lf.scope_id = _brand_ref)
        or (case when lf.scope_type = 'business'
                 then hub.business_project_matches(lf.scope_id, _p.rem_project_id)
                 else false end)
        or (lf.scope_type = 'corporate')
      )
  ),
  eligible_questions as (
    select
      qk.question_key,
      qk.question_template,
      qk.ai_exposure as q_ai_exposure,
      qk.fact_keys as q_fact_keys,
      qk.show_on_project_pages,
      qk.web_sort
    from hub.faq_questions qk
    where qk.status = 'approved'
      and (cardinality(qk.property_types) > 0 and (_form is null or not _form = any(qk.property_types))) is not true
  ),
  -- Resolve rule applicability only for candidates of an eligible question, as
  -- the composer does. The fence keeps the rule call in this select list, so
  -- it runs once per matched candidate and never for other questions' answers.
  resolved_candidates as materialized (
    select
      eq.question_key,
      eq.question_template,
      eq.q_ai_exposure,
      eq.q_fact_keys,
      eq.web_sort,
      c.faq_id,
      c.version_id,
      c.version_no,
      c.scope_type,
      c.rank,
      c.fact_keys as c_fact_keys,
      c.review_due,
      c.effective_to,
      c.ai_exposure as c_ai_exposure,
      c.applicability_rule,
      case
        when c.applicability_rule is not null and c.applicability_rule <> '{}'::jsonb
        then hub.faq_rule_projects(c.applicability_rule, c.scope_type, c.scope_id)
        else c.applies_to_project_ids
      end as phase_ids
    from eligible_questions eq
    join active_candidates c on c.question_key = eq.question_key
    where (c.scope_type <> 'corporate' or eq.show_on_project_pages)
  ),
  matched_candidates as (
    select
      rc.question_key,
      rc.question_template,
      rc.q_ai_exposure,
      rc.q_fact_keys,
      rc.web_sort,
      rc.faq_id,
      rc.version_id,
      rc.version_no,
      rc.scope_type,
      rc.rank,
      rc.c_fact_keys,
      rc.review_due,
      rc.effective_to,
      rc.c_ai_exposure
    from resolved_candidates rc
    where ((_p.rem_project_id = any(rc.phase_ids))
       or (rc.scope_type = 'corporate' and cardinality(rc.phase_ids) = 0 and rc.applicability_rule = '{}'::jsonb)) is distinct from false
  ),
  ranked as (
    select
      mc.*,
      max(mc.rank) over (partition by mc.question_key) as max_rank,
      count(*) over (partition by mc.question_key, mc.rank) as rank_count
    from matched_candidates mc
  ),
  winners as (
    select *
    from ranked
    where rank = max_rank and rank_count = 1
      and (c_ai_exposure is distinct from 'internal')
      and (q_ai_exposure is distinct from 'internal')
      and (effective_to is null or effective_to >= _today)
      and (review_due is null or review_due >= _today)
  ),
  winner_keys as (
    select
      w.question_key,
      w.question_template->>'th' as question_label,
      w.web_sort,
      array(
        select distinct u.k
        from unnest(coalesce(w.c_fact_keys, '{}'::text[]) || coalesce(w.q_fact_keys, '{}'::text[])) as u(k)
        order by u.k
      ) as keys
    from winners w
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'question_key', wk.question_key,
      'question_label', wk.question_label,
      'web_sort', wk.web_sort,
      'combined_keys', to_jsonb(wk.keys)
    ) order by wk.web_sort, wk.question_key
  ), '[]'::jsonb)
  into _winner_list
  from winner_keys wk
  where cardinality(wk.keys) > 0;

  if jsonb_array_length(_winner_list) = 0 then
    return jsonb_build_object('cells', '[]'::jsonb);
  end if;

  select coalesce(array_agg(distinct elem.k order by elem.k), '{}'::text[])
  into _needed_keys
  from (
    select jsonb_array_elements_text(w->'combined_keys') as k
    from jsonb_array_elements(_winner_list) w
  ) elem;

  foreach _key in array _needed_keys loop
    _slot := hub.faq_fact_slot(_p.id, _key, 'th', unit_public_id, false);
    _avail_map := _avail_map || jsonb_build_object(jsonb_build_array(_key)::text, coalesce((_slot->>'available')::boolean, false));
  end loop;

  for _q_rec in select value from jsonb_array_elements(_winner_list) loop
    _missing := '{}'::text[];
    for _key in select jsonb_array_elements_text(_q_rec->'combined_keys') loop
      if not coalesce((_avail_map->>(jsonb_build_array(_key)::text))::boolean, false) then
        _missing := array_append(_missing, _key);
      end if;
    end loop;
    if cardinality(_missing) > 0 then
      _cells := _cells || jsonb_build_array(jsonb_build_object(
        'question_key', _q_rec->>'question_key',
        'question_label', _q_rec->>'question_label',
        'state', 'waiting_for_fact',
        'missing_fact_keys', to_jsonb(_missing)
      ));
    end if;
  end loop;

  return jsonb_build_object('cells', _cells);
end $$;

revoke all on function hub.workspace_missing_fact_cells(uuid,text) from public;

-- Dynamic update of hub.workspace_home to use the new projection helper
do $$
declare definition text; anchor text := 'preview:=hub.compose_project_faq(p.id,''th'',faq_scope.public_id,false,false);';
begin
 definition := replace(pg_get_functiondef('hub.workspace_home(text,text,integer,integer,text,uuid)'::regprocedure), E'\r\n', E'\n');
 if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
  raise exception 'workspace_home definition must contain exactly one compose_project_faq call';
 end if;
 definition := hub.content_definition_replace(definition,
  'preview:=hub.compose_project_faq(p.id,''th'',faq_scope.public_id,false,false);',
  'preview:=hub.workspace_missing_fact_cells(p.id,faq_scope.public_id);');
 execute definition;
end $$;

commit;
