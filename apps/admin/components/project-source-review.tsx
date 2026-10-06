export type SourceReview = {
  status_raw: string | null; status_label: string; is_deleted: boolean | string | null; default_scope: boolean;
  flags: string[]; exceptions: { code: string; keys: Record<string, unknown> }[];
  brand_binding_allowed?: boolean; gold_prefill_allowed?: boolean; first_import_only?: boolean;
};
export type ProjectGroupInfo = {
  rem_project_group_id?: string | null; marketing_project_group_id?: string | null;
  marketing_group_name_th?: string | null; group_mismatch?: boolean; group_issues?: string[];
  group_evidence_status?: string | null;
  group_provenance?: { manifest_sha256: string; source_snapshot_at: string; first_seen_at: string } | null;
};
export function ProjectGroupSummary({ value, details = false }: { value: ProjectGroupInfo; details?: boolean }) {
  return <div className="small-text">
    <p className="source-code">กลุ่มการตลาด: {value.marketing_project_group_id ? `${value.marketing_project_group_id} · ${value.marketing_group_name_th || "ยังไม่มีชื่อกลุ่ม"}` : "ยังไม่ระบุกลุ่ม"}</p>
    {value.group_mismatch && <p className="field-help">รหัสกลุ่มไม่ตรงกัน · REM: <code>{value.rem_project_group_id}</code></p>}
    {details && <details><summary>รายละเอียดกลุ่มต้นทาง</summary><p>รหัสกลุ่ม REM: <code>{JSON.stringify(value.rem_project_group_id ?? null)}</code></p>
      {value.group_provenance && <><p>วันที่สำเนาชื่อกลุ่ม: {value.group_provenance.source_snapshot_at}</p><p className="source-code">ชุดหลักฐาน: {value.group_provenance.manifest_sha256}</p></>}
    </details>}
    {value.group_evidence_status === "changed" && <p className="field-help">ชื่อหรือสมาชิกกลุ่มต้นทางเปลี่ยน · รอตรวจสอบ</p>}
    {value.group_evidence_status === "missing" && <p className="field-help">ไม่พบกลุ่มในชุดข้อมูลล่าสุด · เก็บหลักฐานเดิม</p>}
    {value.group_issues?.map(issue => <p className="field-help" key={issue}>{issue === "MARKETING_GROUP_MISSING" ? "ไม่พบกลุ่มการตลาดในพจนานุกรมต้นทาง" : "สมาชิกกลุ่มต้นทางไม่ตรงกับโครงการ · รอตรวจสอบ"}</p>)}
  </div>;
}
const reasons: Record<string, string> = {
  PROJECT_BRAND_MISSING: "ต้นทางไม่มีแบรนด์ จึงยังผูกแบรนด์ไม่ได้",
  GOLD_PROJECT_IDENTITY_OR_GROUP_CONFLICT: "ตัวตนหรือกลุ่มใน Gold ขัดแย้ง — ปิดการเติมจาก Gold ใช้ REM อ้างอิงตัวตน",
  GOLD_MODEL_ID_MISSING_REM: "รหัสแบบบ้านมีช่องว่างไม่ตรงกัน — เก็บรหัสเดิม ไม่จับคู่อัตโนมัติ",
  MODEL_TYPE_UNKNOWN: "ไม่พบประเภทแบบบ้านในพจนานุกรมต้นทาง",
  BLANK_NAME: "ชื่อภาษาอังกฤษต้นทางว่าง",
};
export function ProjectSourceReview({ value }: { value?: SourceReview }) {
  if (!value) return null;
  return <div className="small-text"><p>สถานะ REM: {value.status_label} ({value.status_raw ?? "null"}){value.is_deleted === true ? " · ถูกลบจากต้นทาง" : value.is_deleted !== false ? " · ไม่ทราบสถานะการลบ" : ""}</p>
    {value.flags?.map(flag => <p key={flag}>{flag === "changed" ? "ต้นทางเปลี่ยน — รอตรวจสอบ" : flag === "missing" ? "ไม่พบในชุดข้อมูลล่าสุด — เก็บหลักฐานเดิม" : "ต้นทางระบุว่าลบแล้ว"}</p>)}
    {value.exceptions?.length > 0 && <ul className="project-gap-list">{value.exceptions.map((finding, index) => <li key={index}>{reasons[finding.code] ?? finding.code}<code className="source-code"> {JSON.stringify(finding.keys)}</code></li>)}</ul>}
  </div>;
}

export function SourceStatusFilter({ id, rows = [], counts, total, value, onChange }: { id: string; rows?: { source_review?: SourceReview }[]; counts?: Record<string, { label: string; count: number }>; total?: number; value: string; onChange: (value: string) => void }) {
  const statuses = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const key = row.source_review?.status_raw ?? "null";
    const old = statuses.get(key);
    statuses.set(key, { label: row.source_review?.status_label ?? "ไม่ทราบสถานะ", count: (old?.count ?? 0) + 1 });
  }
  return <div className="form-field"><label htmlFor={id}>สถานะโครงการ REM</label><select id={id} value={value} onChange={event => onChange(event.target.value)}><option value="all">ทุกสถานะ ({total ?? rows.length})</option>{(counts ? Object.entries(counts) : [...statuses]).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => <option key={key} value={key}>{key === "null" ? "—" : key} {row.label} ({row.count})</option>)}</select></div>;
}
