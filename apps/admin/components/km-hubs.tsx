"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { capabilityKey } from "@/lib/hub-permissions";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";
import { useContentLocation } from "./content-operations-shared";
import { ContentNarrative, type NarrativeSection } from "./content-narrative";
import { ContentContacts, type Contact } from "./content-contacts";
import { AssetImage } from "./private-assets";
import type { Thumbnail } from "./entity-thumbnail";
import { TranslationReviewPanel, errorMessage, useFieldCatalog, type Locales, type Translation } from "./content-common";
import { workspaceHref, workspaceName, type WorkspaceLevel, type WorkspaceTarget } from "@/lib/unified-workspace";
import type { GroupStatus } from "./project-groups";
import "./km-hubs.css";

export type ManagedScopeType = "corporate" | "project_group" | "programme";

export function KmCoverPlate({
  mode = "photo",
  name,
  image,
  brandLogo,
  missingLabel,
  topLeft,
  topRight,
}: {
  mode?: "photo" | "logo";
  name: string;
  image?: Thumbnail | null;
  brandLogo?: Thumbnail | null;
  missingLabel?: string | null;
  topLeft?: ReactNode;
  topRight?: ReactNode;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const primary = image && !failed.includes(image.id) ? image : null;
  const fallbackLogo = !primary && brandLogo && !failed.includes(brandLogo.id) ? brandLogo : null;
  const initials = Array.from(name.trim()).slice(0, 2).join("").toUpperCase() || "SN";

  return (
    <div className={`km-cover-plate is-${mode} ${primary ? (mode === "photo" ? "has-photo" : "has-logo") : fallbackLogo ? "has-logo" : "is-fallback"}`}>
      {primary ? (
        mode === "logo" ? (
          <div className="km-logo-frame">
            <AssetImage
              key={primary.id}
              asset={primary}
              alt={name}
              width={160}
              height={84}
              onError={() => setFailed(prev => (prev.includes(primary.id) ? prev : [...prev, primary.id]))}
            />
          </div>
        ) : (
          <AssetImage
            key={primary.id}
            asset={primary}
            alt={name}
            width={360}
            height={202}
            onError={() => setFailed(prev => (prev.includes(primary.id) ? prev : [...prev, primary.id]))}
          />
        )
      ) : fallbackLogo ? (
        <div className="km-logo-frame">
          <AssetImage
            key={fallbackLogo.id}
            asset={fallbackLogo}
            alt={name}
            width={148}
            height={76}
            onError={() => setFailed(prev => (prev.includes(fallbackLogo.id) ? prev : [...prev, fallbackLogo.id]))}
          />
        </div>
      ) : (
        <span className="km-cover-monogram" aria-hidden="true">{initials}</span>
      )}
      {(topLeft || topRight) && (
        <div className="km-cover-overlay-top">
          <div className="km-cover-badges">{topLeft}</div>
          <div className="km-cover-badges">{topRight}</div>
        </div>
      )}
      {!primary && missingLabel && (
        <span className="km-cover-missing-pill">{missingLabel}</span>
      )}
    </div>
  );
}

type ScopeContentPayload = {
  scope_type: ManagedScopeType;
  scope_id: string;
  sections: NarrativeSection[];
  contacts: Contact[];
  translations: Translation[];
};

const scopeCopy: Record<ManagedScopeType, { heading: string; note: string; narrativeLabel: string }> = {
  corporate: {
    heading: "เนื้อหา KM และช่องทางติดต่อองค์กร SENA",
    note: "ข้อมูลแนะนำองค์กร บริการขององค์กร และช่องทางติดต่อกลาง ใช้ร่วมกันบนหน้าเว็บไซต์เครือและผู้ช่วย AI",
    narrativeLabel: "เนื้อหา KM องค์กร",
  },
  project_group: {
    heading: "เนื้อหา KM ระดับกลุ่มโครงการ",
    note: "เนื้อหา KM ที่อนุมัติในระดับกลุ่มโครงการจะสืบทอดไปยังโครงการสมาชิกทุกเฟสในกลุ่มโดยอัตโนมัติ ช่วยลดการกรอกข้อมูลซ้ำหลายเฟส",
    narrativeLabel: "เนื้อหา KM กลุ่มโครงการ",
  },
  programme: {
    heading: "เนื้อหา KM โปรแกรมและบริการ",
    note: "เนื้อหาหลักของโปรแกรม (เช่น LivNex / RentNex) สำหรับสื่อสารบนเว็บไซต์และผู้ช่วย AI ควบคู่กับคำถามที่พบบ่อยของโปรแกรม",
    narrativeLabel: "เนื้อหา KM โปรแกรม",
  },
};

export function ScopeKmWorkspace({ scopeType, scopeId, onEditingChange, onWorkflowChanged }: {
  scopeType: ManagedScopeType;
  scopeId: string;
  onEditingChange?: (value: boolean) => void;
  onWorkflowChanged?: () => void;
}) {
  const permissions = useHubPermissions();
  const authority = capabilityKey(permissions.account);
  const canView = permissions.can("knowledge");
  const canEdit = permissions.can("knowledge", "edit");
  const { catalog, error: catalogError, reload: reloadCatalog } = useFieldCatalog();
  const base = `v1/admin/content/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}`;
  const identity = `${base}::${authority}`;
  const active = useRef<string | null>(identity);
  active.current = identity;

  const [loaded, setLoaded] = useState<{ identity: string; value: ScopeContentPayload } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);

  const location = useContentLocation(editing, false);
  type SubTab = "narrative" | "contacts" | "english";
  const availableTabs: readonly SubTab[] = scopeType === "corporate" ? ["narrative", "contacts", "english"] : ["narrative", "english"];
  const selected = location.params.get("section");
  const tab: SubTab = (availableTabs as readonly string[]).includes(selected ?? "") ? (selected as SubTab) : "narrative";
  const data = loaded?.identity === identity ? loaded.value : null;

  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);

  const read = useCallback(async () => {
    const value = await request<ScopeContentPayload>(`${base}/content`);
    return {
      ...value,
      sections: value.sections ?? [],
      contacts: value.contacts ?? [],
      translations: value.translations ?? [],
    };
  }, [base]);

  const changed = useCallback(async () => {
    const value = await read();
    if (active.current !== identity) return;
    setLoaded({ identity, value });
    setError("");
    onWorkflowChanged?.();
  }, [read, identity, onWorkflowChanged]);

  useEffect(() => {
    let live = true;
    active.current = identity;
    setLoaded(null);
    setEditing(false);
    setError("");
    if (canView) {
      read()
        .then(value => { if (live && active.current === identity) setLoaded({ identity, value }); })
        .catch(err => { if (live && active.current === identity) setError(errorMessage(err)); });
    }
    return () => {
      live = false;
      if (active.current === identity) active.current = null;
    };
  }, [read, identity, canView, retry]);

  if (!canView) return <p role="alert" className="notice error">บัญชีนี้ไม่มีสิทธิ์ดูเนื้อหา KM ในส่วนนี้</p>;
  const copy = scopeCopy[scopeType];
  const stepMeta: Record<SubTab, { title: string; subtitle: string; count: string }> = {
    narrative: {
      title: copy.narrativeLabel,
      subtitle: scopeType === "project_group" ? "เขียนครั้งเดียว ส่งต่อทุกเฟสในกลุ่ม" : "เนื้อหาแนะนำและบริการหลักสำหรับเว็บและ AI",
      count: `${data?.sections.length ?? 0} หมวด`,
    },
    ...(scopeType === "corporate" ? {
      contacts: {
        title: "ช่องทางติดต่อองค์กร",
        subtitle: "เบอร์โทรกลาง LINE อีเมล และลิงก์ติดต่อหลัก",
        count: `${data?.contacts.length ?? 0} ช่องทาง`,
      },
    } : {}),
    english: {
      title: "ตรวจคำแปลภาษาอังกฤษ",
      subtitle: "ยืนยันคำแปลก่อนส่งอนุมัติเนื้อหา",
      count: `${data?.translations.length ?? 0} รายการ`,
    },
  } as Record<SubTab, { title: string; subtitle: string; count: string }>;
  const stepIdx = availableTabs.indexOf(tab);
  const prevSub = stepIdx > 0 ? availableTabs[stepIdx - 1] : null;
  const nextSub = stepIdx >= 0 && stepIdx < availableTabs.length - 1 ? availableTabs[stepIdx + 1] : null;

  return (
    <section className="content-workspace entity-embedded-content" data-scope-km={`${scopeType}:${scopeId}`} aria-label={copy.heading}>
      <p className="field-help">{copy.note}</p>
      {(error || catalogError) && (
        <p className="notice error" role="alert">
          {error || catalogError}{" "}
          <button type="button" className="button secondary" disabled={editing} onClick={() => { reloadCatalog(); setRetry(v => v + 1); }}>
            ลองใหม่
          </button>
        </p>
      )}
      {!data || !catalog ? (
        !error && !catalogError && <p role="status">กำลังโหลดเนื้อหา KM…</p>
      ) : (
        <>
          <div className="km-step-groups" role="group" aria-label="ขั้นตอนการกรอกเนื้อหาในระดับนี้">
            {availableTabs.map((stepKey, idx) => {
              const info = stepMeta[stepKey];
              const isDone = stepKey === "narrative" ? data.sections.length > 0 : stepKey === "contacts" ? data.contacts.length > 0 : data.translations.length === 0 || data.translations.every(t => t.translation_state === "reviewed");
              return (
                <button
                  type="button"
                  key={stepKey}
                  className="km-step-group-btn"
                  aria-pressed={tab === stepKey}
                  disabled={editing && tab !== stepKey}
                  onClick={() => { if (!editing) location.navigate({ section: stepKey, field: null, item: null }); }}
                >
                  <span className="km-step-group-top">
                    <span className="km-step-group-num">ขั้นที่ {idx + 1}</span>
                    <span className={`km-step-group-badge ${isDone ? "is-done" : ""}`}>{info.count}</span>
                  </span>
                  <span className="km-step-group-title">{info.title}</span>
                  <span className="km-step-group-sub">{info.subtitle}</span>
                </button>
              );
            })}
          </div>
          <nav className="content-tabs" aria-label="หมวดเนื้อหา KM">
            <button type="button" aria-current={tab === "narrative" ? "page" : undefined} disabled={editing && tab !== "narrative"} onClick={() => { if (!editing) location.navigate({ section: "narrative", field: null, item: null }); }}>
              {copy.narrativeLabel}
            </button>
            {scopeType === "corporate" && (
              <button type="button" aria-current={tab === "contacts" ? "page" : undefined} disabled={editing && tab !== "contacts"} onClick={() => { if (!editing) location.navigate({ section: "contacts", field: null, item: null }); }}>
                ช่องทางติดต่อองค์กร
              </button>
            )}
            <button type="button" aria-current={tab === "english" ? "page" : undefined} disabled={editing && tab !== "english"} onClick={() => { if (!editing) location.navigate({ section: "english", field: null, item: null }); }}>
              ภาษาอังกฤษ
            </button>
          </nav>
          <div key={`${identity}:${tab}`}>
            {tab === "narrative" && (
              <ContentNarrative
                key={identity}
                apiBase={base}
                heading={copy.narrativeLabel}
                corporate={scopeType === "corporate"}
                sections={data.sections}
                points={[]}
                fields={catalog.items}
                showPoints={false}
                canEdit={canEdit}
                onChanged={changed}
                onEditingChange={setEditing}
              />
            )}
            {tab === "contacts" && scopeType === "corporate" && (
              <ContentContacts
                items={data.contacts}
                catalog={catalog}
                apiBase="v1/admin/faq/corporate-contacts"
                canEdit={canEdit}
                onChanged={changed}
                onEditingChange={setEditing}
              />
            )}
            {tab === "english" && (
              <TranslationReviewPanel
                items={data.translations}
                fields={catalog.items}
                canEdit={canEdit}
                onChanged={changed}
                onEditingChange={setEditing}
              />
            )}
          </div>
          <div className="km-substep-bar">
            <p className="km-substep-bar-note">
              กำลังอยู่ขั้นที่ {stepIdx + 1} จาก {availableTabs.length}: <strong>{stepMeta[tab].title}</strong>
            </p>
            <div className="km-substep-actions">
              {prevSub && (
                <button type="button" className="button secondary" disabled={editing} onClick={() => { if (!editing) location.navigate({ section: prevSub, field: null, item: null }); }}>
                  ← {stepMeta[prevSub].title}
                </button>
              )}
              {nextSub ? (
                <button type="button" className="button secondary" disabled={editing} onClick={() => { if (!editing) location.navigate({ section: nextSub, field: null, item: null }); }}>
                  ถัดไปในหมวดข้อมูล: {stepMeta[nextSub].title} →
                </button>
              ) : (
                <Link prefetch={false} className="button secondary" href={workspaceHref({ level: scopeType, id: scopeId, tab: "faq" })}>
                  ไปจัดการคลังคำถาม FAQ ระดับนี้ →
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

type GroupRow = {
  state: GroupStatus;
  id: string | null;
  name_th: string | null;
  count: number;
  published: number;
  filling: number;
  awaiting_publisher: number;
  names: string[];
  brand_count: number;
  brand_name?: string | null;
  cover_image?: Thumbnail | null;
  brand_logo?: Thumbnail | null;
  group_km_count?: number;
  group_faq_count?: number;
  group_promotion_count?: number;
};

type GroupPage = { rows: GroupRow[]; page: number; pages: number; total: number };

type ProgressMemberRow = {
  public_project_id: string | null;
  rem_project_id: string;
  name?: string | null;
  name_th?: string | null;
  brand_name?: string | null;
  brand_name_th?: string | null;
  cover_image?: Thumbnail | null;
  thumbnail?: Thumbnail | null;
  brand_logo?: Thumbnail | null;
  published?: boolean;
  filling?: boolean;
  marketing_project_group_id?: string | null;
  group_status?: GroupStatus;
};

type ProgressMemberPage = { rows: ProgressMemberRow[]; total: number; page?: number; pages?: number };

function phaseSortRank(row: { name?: string | null; name_th?: string | null; rem_project_id: string }): [number, string] {
  const label = `${row.name ?? ""} ${row.name_th ?? ""}`.trim();
  const phaseMatch = label.match(/(?:เฟส|phase)\s*(\d+)/i);
  if (phaseMatch) {
    const num = Number(phaseMatch[1]);
    return [num === 1 ? 0 : 1 + num, row.rem_project_id];
  }
  if (/\s1$/.test(label)) return [0, row.rem_project_id];
  const tailNum = label.match(/\s(\d+)$/);
  if (tailNum && Number(tailNum[1]) > 1) return [1 + Number(tailNum[1]), row.rem_project_id];
  return [1, row.rem_project_id];
}

function comparePhaseMembers(a: ProgressMemberRow, b: ProgressMemberRow): number {
  const [rankA, idA] = phaseSortRank(a);
  const [rankB, idB] = phaseSortRank(b);
  if (rankA !== rankB) return rankA - rankB;
  return idA.localeCompare(idB, "en", { numeric: true });
}

type TreeItem = {
  key: string;
  kind: WorkspaceLevel;
  ref: string;
  name: Locales;
  target: WorkspaceTarget;
  has_children: boolean;
  visible_phase_count: number;
};

type ScopeMetricSummary = {
  section_count?: number;
  faq_count?: number;
  contact_count?: number;
  promotion_count?: number;
  project_count?: number;
  brand_count?: number;
};

export function KmProjectGroupsView() {
  const permissions = useHubPermissions();
  const authority = capabilityKey(permissions.account);
  const canProjects = permissions.can("projects");
  const canKnowledge = permissions.can("knowledge");
  const canPromotions = permissions.can("promotions") && permissions.can("projects") && canKnowledge;

  const [searchInput, setSearchInput] = useState("");
  const [term, setTerm] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, ProgressMemberRow[]>>({});
  const [fallbackGroups, setFallbackGroups] = useState<TreeItem[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setPending(true);
    setError("");
    if (canProjects) {
      const groupParams = new URLSearchParams({
        view: "groups",
        page: "1",
        size: "50",
        status: "all",
        rem_status: "all",
        q: term,
        other: String(showOther),
      });
      const memberParams = new URLSearchParams({
        page: "1",
        size: "50",
        status: "all",
        rem_status: "all",
        q: term,
        other: String(showOther),
      });
      Promise.all([
        request<GroupPage>(`v1/admin/projects/progress?${groupParams}`),
        request<ProgressMemberPage>(`v1/admin/projects/progress?${memberParams}`),
      ])
        .then(async ([groupPage, firstMemberPage]) => {
          const totalPages = Math.min(firstMemberPage.pages ?? 1, 10);
          let allMemberRows = [...(firstMemberPage.rows ?? [])];
          if (totalPages > 1) {
            const extraPages = await Promise.all(
              Array.from({ length: totalPages - 1 }, (_, i) => {
                const nextParams = new URLSearchParams(memberParams);
                nextParams.set("page", String(i + 2));
                return request<ProgressMemberPage>(`v1/admin/projects/progress?${nextParams}`);
              })
            );
            for (const extra of extraPages) {
              if (extra.rows?.length) allMemberRows = allMemberRows.concat(extra.rows);
            }
          }
          if (!live) return;
          setGroups(groupPage.rows ?? []);
          const grouped: Record<string, ProgressMemberRow[]> = {};
          for (const row of allMemberRows) {
            const state = row.group_status ?? (row.marketing_project_group_id ? "marketing_reference" : "missing");
            if (state === "marketing_reference" && row.marketing_project_group_id) {
              (grouped[row.marketing_project_group_id] ??= []).push(row);
            }
          }
          for (const list of Object.values(grouped)) list.sort(comparePhaseMembers);
          setMembersByGroup(grouped);
        })
        .catch(err => { if (live) setError(errorMessage(err)); })
        .finally(() => { if (live) setPending(false); });
    } else if (canKnowledge) {
      request<{ items: TreeItem[] }>(`v1/admin/content/workspace/tree?q=${encodeURIComponent(term)}&limit=50`)
        .then(tree => {
          if (!live) return;
          setFallbackGroups((tree.items ?? []).filter(item => item.kind === "project_group"));
        })
        .catch(err => { if (live) setError(errorMessage(err)); })
        .finally(() => { if (live) setPending(false); });
    } else {
      setPending(false);
    }
    return () => { live = false; };
  }, [authority, canProjects, canKnowledge, term, showOther, retry]);

  const confirmedGroups = useMemo(
    () => (groups ?? []).filter(row => row.state === "marketing_reference" && row.id),
    [groups]
  );
  const unconfirmedRows = useMemo(
    () => (groups ?? []).filter(row => row.state !== "marketing_reference"),
    [groups]
  );
  const totalPhasesInGroups = useMemo(
    () => confirmedGroups.reduce((sum, item) => sum + item.count, 0),
    [confirmedGroups]
  );

  return (
    <div className="km-hub" data-km-hub="groups">
      <div className="km-hub-header">
        <div>
          <h1>KM กลุ่มโครงการ (Project Group)</h1>
          <p className="km-hub-subtitle">
            จัดการเนื้อหา KM และ FAQ ระดับกลุ่มโครงการที่ใช้ร่วมกันหลายเฟส ข้อมูลที่อนุมัติแล้วจะส่งต่อไปยังทุกเฟสในกลุ่มอัตโนมัติ
          </p>
        </div>
        {confirmedGroups.length > 0 && (
          <div className="km-hub-kpis" aria-label="สรุปกลุ่มโครงการ">
            <span className="km-kpi-pill">กลุ่มโครงการที่ยืนยันแล้ว <strong>{confirmedGroups.length}</strong> กลุ่ม</span>
            <span className="km-kpi-pill">รวมโครงการสมาชิก <strong>{totalPhasesInGroups}</strong> เฟส</span>
          </div>
        )}
      </div>

      <form className="km-hub-toolbar" onSubmit={event => { event.preventDefault(); setTerm(searchInput.trim()); }}>
        <label>
          ค้นหากลุ่มโครงการ หรือชื่อโครงการในกลุ่ม
          <input
            type="search"
            maxLength={200}
            placeholder="พิมพ์ชื่อกลุ่มโครงการ รหัสกลุ่ม หรือชื่อโครงการเฟส…"
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
          />
        </label>
        {canProjects && (
          <label className="km-hub-check">
            <input
              type="checkbox"
              checked={showOther}
              onChange={event => setShowOther(event.target.checked)}
            />
            แสดงโครงการปิดการขาย / สถานะอื่น
          </label>
        )}
        <button type="submit" className="button secondary">ค้นหา</button>
        {term && (
          <button type="button" className="button secondary" onClick={() => { setSearchInput(""); setTerm(""); }}>
            ล้างคำค้น
          </button>
        )}
      </form>

      {error && (
        <p className="notice error" role="alert">
          {error}{" "}
          <button type="button" className="button secondary" onClick={() => setRetry(v => v + 1)}>ลองใหม่</button>
        </p>
      )}
      {pending && <p role="status">กำลังโหลดข้อมูลกลุ่มโครงการ…</p>}

      {!pending && canProjects && groups && (
        <>
          {confirmedGroups.length === 0 ? (
            <section className="content-section">
              <h2>ยังไม่มีกลุ่มโครงการที่ยืนยันตามตัวกรองนี้</h2>
              <p className="field-help">
                กลุ่มโครงการอ้างอิงจากรหัสกลุ่มการตลาดใน DW หากโครงการยังไม่ได้จัดกลุ่ม สามารถเปิดแก้ไขรายโครงการได้ที่เมนู KM โครงการ
              </p>
              <div className="km-card-actions">
                <Link prefetch={false} className="button secondary" href="/website?view=projects">ไปหน้า KM โครงการ</Link>
              </div>
            </section>
          ) : (
            <div className="km-card-grid">
              {confirmedGroups.map(group => {
                const groupId = group.id!;
                const members = membersByGroup[groupId] ?? [];
                const groupTitle = group.name_th?.trim() || `กลุ่มโครงการ ${groupId}`;
                const phaseOneCover = members.find(m => m.cover_image)?.cover_image ?? members.find(m => m.thumbnail)?.thumbnail ?? group.cover_image;
                const phaseOneLogo = members.find(m => m.brand_logo)?.brand_logo ?? group.brand_logo;
                const resolvedBrandName = group.brand_name || members.find(m => m.brand_name || m.brand_name_th)?.brand_name || members.find(m => m.brand_name_th)?.brand_name_th;
                const brandBadge = group.brand_count > 1 ? `ครอบคลุม ${group.brand_count} แบรนด์` : resolvedBrandName || "กลุ่มโครงการ";
                return (
                  <article className="km-card km-visual-card" key={groupId} data-group-id={groupId}>
                    <KmCoverPlate
                      mode="photo"
                      name={groupTitle}
                      image={phaseOneCover}
                      brandLogo={phaseOneLogo}
                      missingLabel={!phaseOneCover ? "ยังไม่มีรูปหลักเฟส 1" : null}
                      topLeft={<span className="km-overlay-chip">{brandBadge}</span>}
                      topRight={<span className="km-phase-badge">{group.count} เฟส / โครงการ</span>}
                    />
                    <div className="km-visual-body">
                      <div className="km-card-top">
                        <div>
                          <h2>{groupTitle}</h2>
                          <span className="km-code-badge">รหัสกลุ่ม: {groupId}</span>
                        </div>
                      </div>

                      <div className="km-stat-chips" aria-label="สรุปข้อมูลสืบทอดระดับกลุ่ม">
                        <span className="km-stat-chip">KM กลุ่ม <strong>{group.group_km_count ?? 0}</strong></span>
                        <span className="km-stat-chip">FAQ กลุ่ม <strong>{group.group_faq_count ?? 0}</strong></span>
                        <span className="km-stat-chip">โปรโมชันกลุ่ม <strong>{group.group_promotion_count ?? 0}</strong></span>
                        <span className="km-stat-chip">เผยแพร่แล้ว <strong>{group.published}/{group.count}</strong> เฟส</span>
                      </div>

                      <div className="km-member-box">
                        <p className="km-member-title">โครงการและเฟสในกลุ่มนี้ ({group.count} รายการ)</p>
                        {members.length > 0 ? (
                          <ul className="km-member-list">
                            {members.map(member => {
                              const label = `${member.name || member.name_th || member.rem_project_id} · ${member.rem_project_id}`;
                              const tone = member.published ? "is-published" : member.filling ? "is-filling" : "";
                              return (
                                <li key={member.public_project_id ?? member.rem_project_id}>
                                  {member.public_project_id ? (
                                    <Link
                                      prefetch={false}
                                      className={`km-member-link ${tone}`}
                                      href={workspaceHref({ level: "project", id: member.public_project_id, tab: "data" })}
                                    >
                                      {label}
                                    </Link>
                                  ) : (
                                    <span className="km-code-badge">{label}</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="km-meta-row">
                            {group.names.join(" · ") || "ไม่มีรายชื่อตัวอย่าง"}
                            {group.count > group.names.length ? ` และอีก ${group.count - group.names.length} โครงการ` : ""}
                          </p>
                        )}
                      </div>

                      <div className="km-card-actions">
                        {canKnowledge && (
                          <Link prefetch={false} className="button primary" href={workspaceHref({ level: "project_group", id: groupId, tab: "data" })}>
                            แก้ไข KM กลุ่ม
                          </Link>
                        )}
                        {canKnowledge && (
                          <Link prefetch={false} className="button secondary" href={workspaceHref({ level: "project_group", id: groupId, tab: "faq" })}>
                            จัดการ FAQ กลุ่ม
                          </Link>
                        )}
                        {canPromotions && (
                          <Link prefetch={false} className="button secondary" href={workspaceHref({ level: "project_group", id: groupId, tab: "promotions" })}>
                            โปรโมชันกลุ่ม
                          </Link>
                        )}
                        <Link prefetch={false} className="button secondary" href={workspaceHref({ level: "project_group", id: groupId, tab: "overview" })}>
                          ภาพรวมกลุ่ม
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {unconfirmedRows.length > 0 && (
            <details className="km-ungrouped-drawer">
              <summary>
                โครงการที่ยังไม่มีกลุ่มยืนยันหรือรอตรวจสอบกลุ่ม ({unconfirmedRows.reduce((sum, item) => sum + item.count, 0)} โครงการ)
              </summary>
              <div className="km-card-grid" style={{ marginTop: "0.75rem" }}>
                {unconfirmedRows.map(row => (
                  <article className="km-card" key={row.state}>
                    <div className="km-card-top">
                      <h3>{row.state === "conflict" ? "กลุ่มที่ต้องตรวจสอบความขัดแย้ง" : "โครงการเดี่ยว / ยังไม่มีกลุ่มโครงการ"}</h3>
                      <span className="km-phase-badge">{row.count} โครงการ</span>
                    </div>
                    <p className="km-meta-row">
                      {row.names.join(" · ")}
                      {row.count > row.names.length ? ` และอีก ${row.count - row.names.length} โครงการ` : ""}
                    </p>
                    <div className="km-card-actions">
                      <Link prefetch={false} className="button secondary" href={`/website?view=projects&group_state=${encodeURIComponent(row.state)}`}>
                        ดูรายการโครงการเหล่านี้
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {!pending && !canProjects && fallbackGroups && (
        fallbackGroups.length === 0 ? (
          <p>ไม่พบกลุ่มโครงการตามคำค้นหา</p>
        ) : (
          <div className="km-card-grid">
            {fallbackGroups.map(group => (
              <article className="km-card km-visual-card" key={group.key}>
                <KmCoverPlate
                  mode="photo"
                  name={workspaceName(group.name)}
                  topRight={<span className="km-phase-badge">{group.visible_phase_count} เฟส</span>}
                />
                <div className="km-visual-body">
                  <div className="km-card-top">
                    <h2>{workspaceName(group.name)}</h2>
                  </div>
                  <div className="km-card-actions">
                    <Link prefetch={false} className="button primary" href={workspaceHref({ level: "project_group", id: group.ref, tab: "data" })}>
                      แก้ไข KM กลุ่ม
                    </Link>
                    <Link prefetch={false} className="button secondary" href={workspaceHref({ level: "project_group", id: group.ref, tab: "faq" })}>
                      จัดการ FAQ กลุ่ม
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      )}
    </div>
  );
}

type BusinessReferenceRow = {
  code?: string;
  business_code?: string;
  name?: Locales | string;
  label?: Locales | string;
  description?: Locales | string | null;
  status?: string;
};

const programmeDescriptions: Record<string, string> = {
  LIVNEX: "โปรแกรมเช่าออมบ้าน เปลี่ยนค่าเช่าเป็นเงินออมเพื่อเป็นเจ้าของที่อยู่อาศัยเสนา",
  LIVNEX_GOLD: "โปรแกรม LivNex Gold สิทธิประโยชน์เพิ่มเติมสำหรับแผนเช่าออมบ้าน",
  RENTNEX: "บริการเช่าที่อยู่อาศัยพร้อมอยู่จากเสนา ยืดหยุ่นตามช่วงสัญญา",
  RENTNEX_BENEFIT: "สิทธิประโยชน์สำหรับผู้เช่าในโปรแกรม RentNex",
  RENTNEX_INVEST: "โปรแกรมการลงทุนปล่อยเช่าอสังหาริมทรัพย์ร่วมกับเสนา",
};

const businessDescriptions: Record<string, string> = {
  solar: "บริการออกแบบและติดตั้งโซลาร์รูฟท็อปครบวงจรสำหรับบ้านพักอาศัย อาคารพาณิชย์ และโรงงานอุตสาหกรรม พร้อมบริการขออนุญาตและดูแลหลังการขาย",
  senx: "บริการบริหารนิติบุคคลและอาคาร ตัวแทนซื้อ-ขาย-เช่าอสังหาริมทรัพย์ครบวงจร และโซลูชันเทคโนโลยีการอยู่อาศัยในเครือเสนา",
  ngernsod_jaidee: "ผู้ให้บริการสินเชื่อและที่ปรึกษาทางการเงิน วิเคราะห์เครดิต และวางแผนเตรียมความพร้อมเพื่อการมีบ้านในเครือเสนา ภายใต้การกำกับของ ธปท.",
  service: "บริการหลังการขาย การบริหารนิติบุคคล และบริการดูแลลูกบ้าน SENA 360",
};

const businessMeta: Record<string, { emblem: string; website: string; domainLabel: string }> = {
  solar: { emblem: "SL", website: "https://senasolarenergy.com/", domainLabel: "senasolarenergy.com" },
  senx: { emblem: "SX", website: "https://www.senxgroup.com/", domainLabel: "senxgroup.com" },
  ngernsod_jaidee: { emblem: "NJ", website: "https://ngernsodjaidee.com/", domainLabel: "ngernsodjaidee.com" },
};

export function KmBusinessesView() {
  const permissions = useHubPermissions();
  const authority = capabilityKey(permissions.account);
  const canKnowledge = permissions.can("knowledge");
  const canCorporatePromos = permissions.can("promotions") && permissions.can("projects") && canKnowledge;
  const isInternalStaff = ["viewer", "editor", "publisher", "admin", "online_staff"].includes(
    permissions.account?.hub_role ?? permissions.account?.role ?? ""
  ) && !permissions.account?.agency && !permissions.account?.agency_code;

  const [search, setSearch] = useState("");
  const [businesses, setBusinesses] = useState<BusinessReferenceRow[]>([]);
  const [programmes, setProgrammes] = useState<TreeItem[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ScopeMetricSummary>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setPending(true);
    setError("");
    if (!canKnowledge) {
      setPending(false);
      return;
    }
    Promise.all([
      isInternalStaff ? request<BusinessReferenceRow[] | { items?: BusinessReferenceRow[] }>("v1/admin/content/businesses").catch(() => []) : Promise.resolve([]),
      request<{ items: TreeItem[]; programmes?: TreeItem[]; scope_summaries?: Record<string, ScopeMetricSummary> }>("v1/admin/content/workspace/tree?q=&limit=50"),
    ])
      .then(([bizResult, treeResult]) => {
        if (!live) return;
        const bizList = Array.isArray(bizResult) ? bizResult : bizResult?.items ?? [];
        setBusinesses(bizList);
        setProgrammes(treeResult.programmes ?? []);
        setSummaries(treeResult.scope_summaries ?? {});
      })
      .catch(err => { if (live) setError(errorMessage(err)); })
      .finally(() => { if (live) setPending(false); });
    return () => { live = false; };
  }, [authority, canKnowledge, isInternalStaff, retry]);

  const needle = search.trim().toLowerCase();
  const filteredProgrammes = useMemo(
    () => programmes.filter(item => !needle || workspaceName(item.name).toLowerCase().includes(needle) || item.ref.toLowerCase().includes(needle)),
    [programmes, needle]
  );
  const filteredBusinesses = useMemo(
    () => businesses.filter(item => {
      const code = (item.code ?? item.business_code ?? "").toLowerCase();
      // Hide 'residential' from Section 3 so it does not duplicate the dedicated Brands / Groups / Projects tabs
      if (!code || code === "residential") return false;
      const title = workspaceName((item.name ?? item.label ?? code) as Locales | string).toLowerCase();
      const desc = (item.description ? workspaceName(item.description) : businessDescriptions[code] ?? "").toLowerCase();
      const domain = (businessMeta[code]?.domainLabel ?? "").toLowerCase();
      return !needle || code.includes(needle) || title.includes(needle) || desc.includes(needle) || domain.includes(needle);
    }),
    [businesses, needle]
  );

  if (!canKnowledge) return <p role="alert" className="notice error">บัญชีนี้ไม่มีสิทธิ์จัดการ KM องค์กรและธุรกิจอื่น</p>;

  const corpStats = summaries["corporate:sena"];

  return (
    <div className="km-hub" data-km-hub="businesses">
      <div className="km-hub-header">
        <div>
          <h1>KM องค์กรและธุรกิจอื่น</h1>
          <p className="km-hub-subtitle">
            ศูนย์รวมเนื้อหา KM ช่องทางติดต่อ และคลัง FAQ ระดับภาพใหญ่สุดของเครือ SENA โปรแกรมโซลูชัน LivNex / RentNex และกลุ่มธุรกิจในเครือ
          </p>
        </div>
      </div>

      <div className="km-hub-toolbar">
        <label>
          กรององค์กร โปรแกรม หรือหน่วยธุรกิจ
          <input
            type="search"
            maxLength={120}
            placeholder="เช่น SENA, LivNex, RentNex, Solar, SenX, เงินสดใจดี…"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </label>
        {search && (
          <button type="button" className="button secondary" onClick={() => setSearch("")}>ล้างตัวกรอง</button>
        )}
      </div>

      {error && (
        <p className="notice error" role="alert">
          {error}{" "}
          <button type="button" className="button secondary" onClick={() => setRetry(v => v + 1)}>ลองใหม่</button>
        </p>
      )}
      {pending && <p role="status">กำลังโหลดข้อมูลองค์กรและหน่วยธุรกิจ…</p>}

      {(!needle || "sena เสนา ข้อมูลองค์กร corporate".includes(needle)) && (
        <section className="km-section-block" aria-label="ข้อมูลองค์กร SENA">
          <h2>1. ข้อมูลองค์กรหลัก (Corporate SENA)</h2>
          <article className="km-card km-visual-card km-corporate-hero" data-corporate-card="sena">
            <div className="km-corporate-banner">
              <div className="km-corporate-logo-plate">
                <img src="/brand/sena-development-logo.png" width={150} height={96} alt="SENA Development" />
              </div>
              <div className="km-corporate-banner-badges">
                <span className="km-overlay-chip">องค์กรหลัก</span>
                <span className="km-phase-badge">ระดับเครือ SENA</span>
              </div>
            </div>
            <div className="km-visual-body">
              <div className="km-card-top">
                <div>
                  <h3>ข้อมูลองค์กร เสนาดีเวลลอปเม้นท์ (SENA Development)</h3>
                  <span className="km-code-badge">corporate / sena</span>
                </div>
              </div>
              <p className="km-meta-row">
                จัดการข้อมูลแนะนำองค์กร บริการหลักของเครือ ช่องทางติดต่อกลาง (Call Center 1775 / LINE / อีเมลกลาง) และคลังคำถามมาตรฐานระดับองค์กรสำหรับเว็บไซต์และ AI
              </p>
              {corpStats && (
                <div className="km-stat-chips" aria-label="สรุปข้อมูลระดับองค์กร">
                  <span className="km-stat-chip">ครอบคลุม <strong>{corpStats.project_count ?? 0}</strong> โครงการ</span>
                  <span className="km-stat-chip">เนื้อหา KM <strong>{corpStats.section_count ?? 0}</strong> หมวด</span>
                  <span className="km-stat-chip">FAQ องค์กร <strong>{corpStats.faq_count ?? 0}</strong> ข้อ</span>
                  <span className="km-stat-chip">ช่องทางติดต่อ <strong>{corpStats.contact_count ?? 0}</strong> ช่อง</span>
                  <span className="km-stat-chip">โปรโมชันเครือ <strong>{corpStats.promotion_count ?? 0}</strong></span>
                </div>
              )}
              <div className="km-card-actions">
                <Link prefetch={false} className="button primary" href="/website/corporate/sena?tab=data">
                  แก้ไข KM องค์กร
                </Link>
                <Link prefetch={false} className="button secondary" href="/website/corporate/sena?tab=data&section=contacts">
                  ช่องทางติดต่อองค์กร
                </Link>
                <Link prefetch={false} className="button secondary" href="/website/corporate/sena?tab=faq">
                  จัดการ FAQ องค์กร
                </Link>
                {canCorporatePromos && (
                  <Link prefetch={false} className="button secondary" href="/website/corporate/sena?tab=promotions">
                    โปรโมชันระดับเครือ
                  </Link>
                )}
              </div>
            </div>
          </article>
        </section>
      )}

      {!pending && filteredProgrammes.length > 0 && (
        <section className="km-section-block" aria-label="โปรแกรม LivNex และ RentNex">
          <h2>2. โปรแกรมโซลูชันการอยู่อาศัย (LivNex · RentNex)</h2>
          <div className="km-card-grid">
            {filteredProgrammes.map(item => {
              const stats = summaries[`programme:${item.ref}`];
              const isRent = item.ref.startsWith("RENTNEX");
              return (
                <article className="km-card km-visual-card" key={item.key} data-programme-card={item.ref}>
                  <div className={`km-emblem-header ${isRent ? "is-rentnex" : "is-livnex"}`}>
                    <span className="km-emblem-mark" aria-hidden="true">{isRent ? "RN" : "LN"}</span>
                    <div className="km-cover-overlay-top">
                      <span className="km-overlay-chip">โปรแกรมโซลูชัน</span>
                      {item.visible_phase_count > 0 && (
                        <span className="km-phase-badge">ร่วม {item.visible_phase_count} โครงการ</span>
                      )}
                    </div>
                  </div>
                  <div className="km-visual-body">
                    <div className="km-card-top">
                      <div>
                        <h3>{workspaceName(item.name)}</h3>
                        <span className="km-code-badge">{item.ref}</span>
                      </div>
                    </div>
                    <p className="km-meta-row">
                      {programmeDescriptions[item.ref] ?? "เนื้อหา KM และคำถามที่พบบ่อยสำหรับโปรแกรมนี้"}
                    </p>
                    {stats && (
                      <div className="km-stat-chips">
                        <span className="km-stat-chip">เนื้อหา KM <strong>{stats.section_count ?? 0}</strong> หมวด</span>
                        <span className="km-stat-chip">FAQ โปรแกรม <strong>{stats.faq_count ?? 0}</strong> ข้อ</span>
                      </div>
                    )}
                    <div className="km-card-actions">
                      <Link prefetch={false} className="button primary" href={workspaceHref({ level: "programme", id: item.ref, tab: "data" })}>
                        แก้ไข KM โปรแกรม
                      </Link>
                      <Link prefetch={false} className="button secondary" href={workspaceHref({ level: "programme", id: item.ref, tab: "faq" })}>
                        จัดการ FAQ โปรแกรม
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!pending && isInternalStaff && filteredBusinesses.length > 0 && (
        <section className="km-section-block" aria-label="หน่วยธุรกิจในเครือ">
          <h2>3. กลุ่มธุรกิจในเครือ (Solar · SenX · เงินสดใจดี)</h2>
          <div className="km-card-grid">
            {filteredBusinesses.map(item => {
              const code = item.code ?? item.business_code ?? "";
              if (!code) return null;
              const lower = code.toLowerCase();
              const meta = businessMeta[lower];
              const title = workspaceName((item.name ?? item.label ?? code) as Locales | string);
              const desc = item.description
                ? workspaceName(item.description)
                : businessDescriptions[lower] ?? "จัดการเนื้อหา KM ช่องทางติดต่อ และ FAQ เฉพาะหน่วยธุรกิจนี้";
              const stats = summaries[`business:${code}`];
              const emblem = meta?.emblem ?? code.slice(0, 2).toUpperCase();
              return (
                <article className="km-card km-visual-card" key={code} data-business-card={code}>
                  <div className="km-emblem-header is-business">
                    <span className="km-emblem-mark" aria-hidden="true">{emblem}</span>
                    <div className="km-cover-overlay-top">
                      <span className="km-overlay-chip">ธุรกิจในเครือ</span>
                      {meta?.domainLabel ? (
                        <span className="km-phase-badge">{meta.domainLabel}</span>
                      ) : stats?.brand_count != null && stats.brand_count > 0 ? (
                        <span className="km-phase-badge">{stats.brand_count} แบรนด์</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="km-visual-body">
                    <div className="km-card-top">
                      <div>
                        <h3>{title}</h3>
                        <span className="km-code-badge">business / {code}</span>
                      </div>
                    </div>
                    <p className="km-meta-row">{desc}</p>
                    {stats && (
                      <div className="km-stat-chips">
                        <span className="km-stat-chip">เนื้อหา KM <strong>{stats.section_count ?? 0}</strong> หมวด</span>
                        <span className="km-stat-chip">FAQ ธุรกิจ <strong>{stats.faq_count ?? 0}</strong> ข้อ</span>
                        <span className="km-stat-chip">ช่องทางติดต่อ <strong>{stats.contact_count ?? 0}</strong></span>
                      </div>
                    )}
                    <div className="km-card-actions">
                      <Link prefetch={false} className="button primary" href={`/website/business/${encodeURIComponent(code)}?tab=data`}>
                        แก้ไข KM ธุรกิจ
                      </Link>
                      <Link prefetch={false} className="button secondary" href={`/website/business/${encodeURIComponent(code)}?tab=data&section=contacts`}>
                        ช่องทางติดต่อ
                      </Link>
                      <Link prefetch={false} className="button secondary" href={`/website/business/${encodeURIComponent(code)}?tab=faq`}>
                        จัดการ FAQ ธุรกิจ
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
