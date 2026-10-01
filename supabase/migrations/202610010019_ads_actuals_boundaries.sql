-- Keep the established staging namespace private; expose only guarded ads RPCs.
begin;
alter function staging.apply_ads_actuals(jsonb,jsonb,text,text) set schema ads;
alter function staging.ads_actuals_current_snapshot() set schema ads;
alter function ads.ads_actuals_current_snapshot() rename to actuals_current_snapshot;
revoke usage on schema staging from admin;
grant execute on function ads.apply_ads_actuals(jsonb,jsonb,text,text),ads.actuals_current_snapshot() to admin;
-- Several typed budget items can share one required document for their component.
create or replace function ads.actuals_documents(selected_month date default null) returns setof jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
with months as (
 select l.id::text line_key,coalesce(l.month,selected_month) as month,r.id::text revision_key,s.scope_code,l.agency
 from ads.media_line l join ads.media_line_revision r on r.line_id=l.id and r.status='APPROVED'
 left join ads.scope_code s on s.scope_id=l.scope_id
 where l.state='ACTIVE' and ((l.month is not null and(selected_month is null or l.month=selected_month))
 or(l.month is null and selected_month between l.period_start_month and l.period_end_month))
), subjects as (
 select x.*, 'COMPONENT'::text subject_kind,c.id::text subject_id,b.cost_type::text,b.payment_method::text,
 coalesce(c.memo_snapshot->>'memo_no',mm.memo_no,c.observed_memo_no) memo_ref,c.fee_po_ref,
 '{}'::jsonb evidence_refs,null::text statement_ref,null::text commitment_ref,null::text account_ref,
 jsonb_build_array(c.row_version,b.versions,mm.row_version,l.row_version,r.row_version) versions,
 '/ads/finance?view=media-lines'::text source_link
 from months x join ads.media_line l on l.id::text=x.line_key join ads.media_line_revision r on r.id::text=x.revision_key and r.status='APPROVED' and l.state='ACTIVE'
 join ads.media_line_component c on c.revision_id=r.id left join lateral(select bi.cost_type,bi.payment_method,jsonb_agg(jsonb_build_array(bi.id,bi.row_version) order by bi.id) versions from ads.line_budget_item bi where bi.component_id=c.id group by bi.cost_type,bi.payment_method) b on true left join ads.memo mm on mm.id=c.memo_id
 union all
 select x.*,'COST',c.id::text,c.cost_type::text,c.payment_method::text,coalesce(mm.memo_no,c.observed_memo_no),null,c.evidence_refs,
 cb.statement_control_id::text,c.commitment_occurrence_id::text,c.account_mapping_id::text,jsonb_build_array(c.row_version,mm.row_version,cb.row_version),'/ads/finance?view=cost-records'
 from months x join ads.cost_record c on c.line_id::text=x.line_key and date_trunc('month',c.charge_date)::date=x.month and c.status='CONFIRMED'
 left join ads.memo mm on mm.id=c.memo_id left join staging.ads_card_row cr on cr.id=c.source_row_id left join staging.ads_card_batch cb on cb.id=cr.batch_id
 where cb.id is null or cb.status='CONFIRMED'
), required as (
 select s.*,coalesce(req.status,'UNAVAILABLE') matrix_status,req.version requirement_version,
 unnest(case when coalesce(cardinality(req.requirement_codes),0)=0 then array['UNKNOWN'] else req.requirement_codes end) requirement_code,
 req.row_version matrix_version
 from subjects s left join lateral(select q.* from ads.document_requirement q where q.cost_type::text=s.cost_type and q.payment_method::text=s.payment_method and q.status<>'RETIRED' and s.month>=date_trunc('month',q.valid_from)::date and(q.valid_to is null or s.month<q.valid_to) order by q.version desc limit 1) req on true
), references_present as (
 select *,case requirement_code when 'M' then coalesce(memo_ref,evidence_refs->>'M') when 'S' then coalesce(evidence_refs->>'S',statement_ref)
 when 'A' then coalesce(evidence_refs->>'A',account_ref) when 'C' then coalesce(evidence_refs->>'C',commitment_ref)
 when 'P' then null when 'UNKNOWN' then null else evidence_refs->>requirement_code end reference,
 case when requirement_code='P' then coalesce(fee_po_ref,evidence_refs->>'P') end partial_reference
 from required
), keyed as (
 select *,encode(sha256(convert_to(jsonb_build_array(line_key,month,subject_kind,subject_id,requirement_version,cost_type,payment_method,requirement_code)::text,'UTF8')),'hex') key,
 encode(sha256(convert_to(jsonb_build_array(versions,matrix_version,reference,partial_reference,revision_key)::text,'UTF8')),'hex') source_version
 from references_present
)
select jsonb_build_object('key',key,'line_id',line_key,'month',month,'scope_code',scope_code,'agency',agency,'subject_kind',subject_kind,'subject_id',subject_id,
 'cost_type',cost_type,'payment_method',payment_method,'requirement_code',requirement_code,'requirement_version',requirement_version,'matrix_status',matrix_status,
 'status',case when nullif(btrim(reference),'') is null then 'MISSING' else 'REFERENCE_RECORDED' end,'reference',reference,'partial_reference',partial_reference,
 'reason',case when requirement_code='UNKNOWN' then 'MATRIX_UNAVAILABLE' when requirement_code='P' then 'PO_AND_INVOICE_PAIR_UNAVAILABLE' else 'VERIFICATION_NOT_AUTHORIZED' end,
 'source_version',source_version,'source_link',source_link,'owner',null,'due_at',null,'is_overdue',null,'template_version','1',
 'message_th','ขอติดตามเอกสารอ้างอิง '||requirement_code||' สำหรับรายการ '||coalesce(scope_code,line_key)||' เดือน '||to_char(month,'MM/')||(extract(year from month)::integer+543)::text||' กรุณาส่งข้อมูลให้ผู้รับผิดชอบเพื่อตรวจสอบใน Hub',
 'follow_ups',coalesce((select jsonb_agg(to_jsonb(f) order by f.copied_at desc) from ads.document_follow_up f where f.key=keyed.key),'[]')) from keyed
$$;
commit;
