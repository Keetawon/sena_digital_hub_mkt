"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { can, canWorkspace } from "@/lib/hub-permissions";
import { encodeQrMatrix } from "@/lib/qr-svg";
import { roleLabels, type LocalRole } from "@/lib/roles";
import { LocalPersonaPicker, useHubPermissions } from "./accounts";
import { EventChangeBanner } from "./event-change-banner";
import { HubShell } from "./hub-shell";
import type { HubSection } from "./hub-navigation-data";
import { request } from "./hub-request";
import "./events-workspace.css";

type RefOption = { id: string; label: string; rem_project_id?: string };
type EventReferences = {
  actor: { id: string; display_name_th: string; phone: string; team: string; can_write: boolean };
  buds: RefOption[];
  projects: RefOption[];
  businesses: RefOption[];
  programmes: RefOption[];
};

type EventSummary = {
  id: string;
  event_code: string;
  event_category: "partner_booth" | "project_onsite" | "corporate_expo" | "sub_business_event";
  title: string;
  venue_name: string;
  venue_zone: string;
  province: string;
  starts_at: string;
  ends_at: string;
  host_scope_type: "corporate" | "bud" | "project_group" | "project" | "programme" | "business";
  host_scope_id: string;
  host_label: string;
  partner_org_name: string;
  open_for_join: boolean;
  join_deadline_at: string | null;
  max_co_joiners: number | null;
  cost_share_mode: "free_invite" | "fixed_slot" | "proportional_split";
  estimated_cost_thb: number | null;
  memo_no: string | null;
  campaign_code: string | null;
  contact_name: string;
  contact_phone: string;
  state: "scheduled" | "postponed" | "cancelled";
  live_status: "upcoming_open" | "upcoming_closed" | "live_now" | "completed" | "postponed" | "cancelled";
  cancel_reason: string | null;
  revision: number;
  schedule_revision: number;
  approved_join_count: number;
  pending_join_count: number;
  pending_ack_count: number;
  joined_labels: string[];
  attachment_count: number;
  has_floor_plan: boolean;
  can_manage: boolean;
  can_read_finance: boolean;
  updated_at: string;
};

type EventAttachment = {
  id: string;
  asset_id: string;
  doc_kind: "floor_plan" | "venue_rules" | "quotation" | "artwork" | "onsite_photo" | "other";
  visibility: "operational" | "finance_restricted";
  title: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  version_no: number;
  download_url: string;
  created_at: string;
};

type EventParticipant = {
  id: string;
  participant_scope_type: EventSummary["host_scope_type"];
  participant_scope_id: string;
  participant_label: string;
  join_state: "requested" | "approved" | "declined" | "withdrawn";
  staff_count: number;
  booth_needs: string;
  shares_cost: boolean;
  cost_share_thb: number | null;
  memo_no: string | null;
  contact_name: string;
  contact_phone: string;
  decision_note: string | null;
  is_mine: boolean;
  qr_registration_url: string;
};

type EventAck = {
  id: string;
  target_kind: "participant" | "online_ads";
  target_label: string;
  contact_name: string;
  contact_phone: string;
  acked_at: string | null;
  ack_note: string | null;
  can_ack: boolean;
};

type EventRevision = {
  id: string;
  schedule_revision: number;
  change_type: string;
  change_reason: string;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
  created_at: string;
  acknowledgements: EventAck[];
};

type EventDetail = Omit<EventSummary, "approved_join_count" | "pending_join_count" | "pending_ack_count" | "joined_labels" | "attachment_count" | "has_floor_plan"> & {
  setup_notes: string;
  audience_visibility: "internal_only" | "public_web";
  qr_registration_url: string;
  attachments: EventAttachment[];
  participants: EventParticipant[];
  revisions: EventRevision[];
};

type PendingUpload = {
  asset_id: string;
  filename: string;
  doc_kind: EventAttachment["doc_kind"];
  visibility: EventAttachment["visibility"];
};

const categoryLabels: Record<EventSummary["event_category"], string> = {
  partner_booth: "ดีลห้าง / พันธมิตรนอกสถานที่",
  project_onsite: "จัดงานที่โครงการ (Onsite)",
  corporate_expo: "มหกรรมกลางเครือเสนา",
  sub_business_event: "อีเวนต์ธุรกิจในเครือ",
};

const costModeLabels: Record<EventSummary["cost_share_mode"], string> = {
  free_invite: "ชวนแจมฟรี (ไม่คิดค่าพื้นที่)",
  proportional_split: "หารงบตามสัดส่วนทีมที่ร่วม",
  fixed_slot: "เหมาจ่ายคงที่ต่อสล็อต",
};

const docKindLabels: Record<EventAttachment["doc_kind"], string> = {
  floor_plan: "ผังบูธ / จุดตั้งบูธ",
  venue_rules: "ใบเข้าอาคาร / กฎสถานที่",
  quotation: "ใบเสนอราคา / สัญญา / E-Memo",
  artwork: "อาร์ตเวิร์ก / ป้ายหน้างาน",
  onsite_photo: "ภาพถ่ายหน้างานจริง",
  other: "เอกสารประกอบอื่นๆ",
};

function defaultInputRange() {
  const start = new Date(Date.now() + 3 * 86400_000);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 86400_000);
  end.setHours(20, 0, 0, 0);
  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return { startsLocal: fmt(start), endsLocal: fmt(end) };
}

function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateRange(startsAt: string, endsAt: string) {
  try {
    const fmt = new Intl.DateTimeFormat("th-TH", {
      day: "numeric",
      month: "short",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bangkok",
    });
    return `${fmt.format(new Date(startsAt))} – ${fmt.format(new Date(endsAt))}`;
  } catch {
    return `${startsAt} – ${endsAt}`;
  }
}

function QrCodeSvg({ url, size = 196 }: { url: string; size?: number }) {
  const matrix = useMemo(() => encodeQrMatrix(url), [url]);
  const quiet = 3;
  const viewSize = matrix.length + quiet * 2;
  return (
    <svg
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      width={size}
      height={size}
      role="img"
      aria-label={`QR ลงทะเบียนอีเวนต์ ${url}`}
      style={{ display: "block", margin: "0 auto", background: "#fff", borderRadius: "8px" }}
      shapeRendering="crispEdges"
    >
      <rect width={viewSize} height={viewSize} fill="#ffffff" />
      {matrix.map((row, r) =>
        row.map((dark, c) =>
          dark ? <rect key={`${r}-${c}`} x={c + quiet} y={r + quiet} width={1} height={1} fill="#10312e" /> : null
        )
      )}
    </svg>
  );
}

async function uploadEventAsset(file: File): Promise<{ id: string; filename: string }> {
  const resp = await fetch("/api/hub/v1/admin/assets", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": file.type || "application/pdf",
      "X-Filename": encodeURIComponent(file.name),
      "X-Upload-Context": JSON.stringify({ v: 1, kind: "intake" }),
    },
    body: await file.arrayBuffer(),
  });
  const payload = (await resp.json().catch(() => ({}))) as {
    data?: { id?: string; asset?: { id?: string } };
    error?: { message?: string };
  };
  const assetId = payload?.data?.id ?? payload?.data?.asset?.id;
  if (!resp.ok || !assetId) {
    throw new Error(payload?.error?.message || "อัปโหลดไฟล์ไม่สำเร็จ (รองรับ PDF, PNG, JPEG, WebP ไม่เกิน 10 MB)");
  }
  return { id: assetId, filename: file.name };
}

export function EventsWorkspace({
  localMode = false,
  initialRole = null,
}: {
  localMode?: boolean;
  initialRole?: LocalRole | null;
}) {
  const { account } = useHubPermissions();
  const router = useRouter();
  const searchParams = useSearchParams();

  const shellSection: HubSection = useMemo(() => {
    const caps = account?.capabilities;
    if (can(caps, "promotions")) return "promotions";
    if (can(caps, "projects")) return "projects";
    if (can(caps, "knowledge")) return "faq";
    if (can(caps, "registry")) return "registry";
    return "promotions";
  }, [account?.capabilities]);

  const staffAllowed =
    account?.status === "ACTIVE" &&
    !account?.agency &&
    !account?.agency_code &&
    (canWorkspace(account?.capabilities) ||
      can(account?.capabilities, "registry") ||
      can(account?.capabilities, "finance"));

  const activeFilter = (searchParams.get("filter") as "all" | "open_join" | "upcoming" | "changed" | "mine") || "all";
  const selectedEventParam = searchParams.get("event");

  const [refs, setRefs] = useState<EventReferences | null>(null);
  const [items, setItems] = useState<EventSummary[]>([]);
  const [counts, setCounts] = useState({ all: 0, open_join: 0, upcoming: 0, changed: 0, mine: 0 });
  const [searchQ, setSearchQ] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [joinTarget, setJoinTarget] = useState<EventSummary | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "joiners" | "changes" | "qr">("overview");
  const [selectedQrUrl, setSelectedQrUrl] = useState<string>("");
  const [selectedQrLabel, setSelectedQrLabel] = useState<string>("");

  // Quick 30-second create state
  const defaults = useMemo(() => defaultInputRange(), []);
  const [cTitle, setCTitle] = useState("");
  const [cVenue, setCVenue] = useState("");
  const [cZone, setCZone] = useState("");
  const [cProvince, setCProvince] = useState("กรุงเทพมหานคร");
  const [cCategory, setCCategory] = useState<EventSummary["event_category"]>("partner_booth");
  const [cStarts, setCStarts] = useState(defaults.startsLocal);
  const [cEnds, setCEnds] = useState(defaults.endsLocal);
  const [cHostKey, setCHostKey] = useState("corporate:SENA:การตลาดกลางเครือเสนา");
  const [cOpenJoin, setCOpenJoin] = useState(true);
  const [cCostMode, setCCostMode] = useState<EventSummary["cost_share_mode"]>("proportional_split");
  const [cShowAdvanced, setCShowAdvanced] = useState(false);
  const [cPartner, setCPartner] = useState("");
  const [cMaxJoiners, setCMaxJoiners] = useState("4");
  const [cEstCost, setCEstCost] = useState("");
  const [cMemoNo, setCMemoNo] = useState("");
  const [cCampaignCode, setCCampaignCode] = useState("");
  const [cSetupNotes, setCSetupNotes] = useState("");
  const [cContactName, setCContactName] = useState("");
  const [cContactPhone, setCContactPhone] = useState("");
  const [cUploads, setCUploads] = useState<PendingUpload[]>([]);
  const [cUploading, setCUploading] = useState(false);
  const [cSubmitting, setCSubmitting] = useState(false);

  // 10-second Co-Join state
  const [jScopeKey, setJScopeKey] = useState("business:solar:เสนา โซลาร์ เอนเนอร์ยี่");
  const [jStaffCount, setJStaffCount] = useState("2");
  const [jNeeds, setJNeeds] = useState("");
  const [jSharesCost, setJSharesCost] = useState(false);
  const [jCostThb, setJCostThb] = useState("");
  const [jMemoNo, setJMemoNo] = useState("");
  const [jContactName, setJContactName] = useState("");
  const [jContactPhone, setJContactPhone] = useState("");
  const [jSubmitting, setJSubmitting] = useState(false);

  // Critical Change / Update state inside Detail Drawer
  const [uVenue, setUVenue] = useState("");
  const [uZone, setUZone] = useState("");
  const [uStarts, setUStarts] = useState("");
  const [uEnds, setUEnds] = useState("");
  const [uState, setUState] = useState<EventSummary["state"]>("scheduled");
  const [uReason, setUReason] = useState("");
  const [uCampaign, setUCampaign] = useState("");
  const [uOpenJoin, setUOpenJoin] = useState(true);
  const [uSaving, setUSaving] = useState(false);
  const [dUploadKind, setDUploadKind] = useState<EventAttachment["doc_kind"]>("floor_plan");
  const [dNotifyChange, setDNotifyChange] = useState(false);
  const [dUploading, setDUploading] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(cur => (cur === msg ? null : cur)), 4000);
  }, []);

  const allScopeChoices = useMemo(() => {
    if (!refs) return [{ key: "corporate:SENA:การตลาดกลางเครือเสนา", label: "ส่วนกลาง · การตลาดกลางเครือเสนา" }];
    const list: { key: string; label: string }[] = [
      { key: "corporate:SENA:การตลาดกลางเครือเสนา", label: "ส่วนกลาง · การตลาดกลางเครือเสนา" },
      ...refs.businesses.map(b => ({ key: `business:${b.id}:${b.label}`, label: `ธุรกิจในเครือ · ${b.label}` })),
      ...refs.programmes.map(p => ({ key: `programme:${p.id}:${p.label}`, label: `โปรแกรม · ${p.label}` })),
      ...refs.buds.map(b => ({ key: `bud:${b.id}:${b.label}`, label: `BUD · ${b.label}` })),
      ...refs.projects.slice(0, 40).map(p => ({ key: `project:${p.id}:${p.label}`, label: `โครงการ · ${p.label}` })),
    ];
    return list;
  }, [refs]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams({ filter: activeFilter, limit: "50" });
      if (searchQ.trim()) qs.set("q", searchQ.trim());
      if (scopeFilter) qs.set("scope", scopeFilter);
      const [refRes, listRes] = await Promise.all([
        refs ? Promise.resolve(refs) : request<EventReferences>("v1/admin/events/references"),
        request<{ items: EventSummary[]; counts: typeof counts }>(`v1/admin/events?${qs.toString()}`),
      ]);
      if (!refs && refRes) {
        setRefs(refRes);
        setCContactName(refRes.actor.display_name_th || "");
        setCContactPhone(refRes.actor.phone || "");
        setJContactName(refRes.actor.display_name_th || "");
        setJContactPhone(refRes.actor.phone || "");
      }
      if (listRes) {
        setItems(listRes.items);
        setCounts(listRes.counts);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "โหลดข้อมูลอีเวนต์เครือไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [activeFilter, searchQ, scopeFilter, refs]);

  const openEventDetail = useCallback(async (eventId: string, initialTab: "overview" | "joiners" | "changes" | "qr" = "overview") => {
    try {
      const ev = await request<EventDetail>(`v1/admin/events/${eventId}`);
      setDetail(ev);
      setDetailTab(initialTab);
      setUVenue(ev.venue_name);
      setUZone(ev.venue_zone);
      setUStarts(isoToLocalInput(ev.starts_at));
      setUEnds(isoToLocalInput(ev.ends_at));
      setUState(ev.state);
      setUReason("");
      setUCampaign(ev.campaign_code || "");
      setUOpenJoin(ev.open_for_join);
      setSelectedQrUrl(ev.qr_registration_url);
      setSelectedQrLabel(`${ev.event_code} · บูธหลัก (${ev.host_label})`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "ไม่สามารถเปิดรายละเอียดอีเวนต์ได้");
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (selectedEventParam && (!detail || detail.id !== selectedEventParam)) {
      void openEventDetail(selectedEventParam);
    }
  }, [selectedEventParam, detail, openEventDetail]);

  function setFilterParam(nextFilter: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (nextFilter === "all") next.delete("filter");
    else next.set("filter", nextFilter);
    next.delete("event");
    router.push(`/events${next.toString() ? `?${next.toString()}` : ""}`);
  }

  async function handleQuickFilesSelected(fileList: FileList | null, docKind: EventAttachment["doc_kind"]) {
    if (!fileList?.length) return;
    setCUploading(true);
    setErrorMsg(null);
    try {
      for (const file of Array.from(fileList)) {
        const uploaded = await uploadEventAsset(file);
        const vis: EventAttachment["visibility"] = docKind === "quotation" ? "finance_restricted" : "operational";
        setCUploads(prev => [...prev, { asset_id: uploaded.id, filename: uploaded.filename, doc_kind: docKind, visibility: vis }]);
        if (!cTitle.trim()) {
          const guessed = uploaded.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
          if (guessed) setCTitle(guessed);
        }
      }
      showToast("แนบไฟล์ขึ้นระบบเรียบร้อยแล้ว");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "อัปโหลดไฟล์ไม่สำเร็จ");
    } finally {
      setCUploading(false);
    }
  }

  async function submitQuickCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!cTitle.trim() || !cVenue.trim()) return;
    setCSubmitting(true);
    setErrorMsg(null);
    try {
      const [hostType, hostId, ...hostLabelParts] = cHostKey.split(":");
      const hostLabel = hostLabelParts.join(":") || hostId;
      let created = await request<EventDetail>("v1/admin/events", "POST", {
        event_category: cCategory,
        title: cTitle.trim(),
        venue_name: cVenue.trim(),
        venue_zone: cZone.trim(),
        province: cProvince.trim() || "กรุงเทพมหานคร",
        starts_at: new Date(cStarts).toISOString(),
        ends_at: new Date(cEnds).toISOString(),
        setup_notes: cSetupNotes.trim(),
        host_scope_type: hostType,
        host_scope_id: hostId,
        host_label: hostLabel,
        partner_org_name: cPartner.trim(),
        open_for_join: cOpenJoin,
        max_co_joiners: cMaxJoiners ? Number(cMaxJoiners) : null,
        cost_share_mode: cCostMode,
        estimated_cost_thb: cEstCost ? Number(cEstCost) : null,
        memo_no: cMemoNo.trim() || null,
        campaign_code: cCampaignCode.trim() || null,
        contact_name: cContactName.trim(),
        contact_phone: cContactPhone.trim(),
      });
      for (const up of cUploads) {
        created = await request<EventDetail>(`v1/admin/events/${created.id}/attachments`, "POST", {
          asset_id: up.asset_id,
          doc_kind: up.doc_kind,
          visibility: up.visibility,
          title: up.filename,
        });
      }
      setShowCreate(false);
      setCTitle("");
      setCVenue("");
      setCZone("");
      setCUploads([]);
      showToast(`สร้างอีเวนต์ ${created.event_code} พร้อมเปิดตลาดแจมบูธแล้ว`);
      await loadEvents();
      setDetail(created);
      setDetailTab("qr");
      setSelectedQrUrl(created.qr_registration_url);
      setSelectedQrLabel(`${created.event_code} · บูธหลัก (${created.host_label})`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "บันทึกอีเวนต์ไม่สำเร็จ");
    } finally {
      setCSubmitting(false);
    }
  }

  async function submitCoJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinTarget) return;
    setJSubmitting(true);
    setErrorMsg(null);
    try {
      const [pType, pId, ...pLabelParts] = jScopeKey.split(":");
      const pLabel = pLabelParts.join(":") || pId;
      const updated = await request<EventDetail>(`v1/admin/events/${joinTarget.id}/join`, "POST", {
        participant_scope_type: pType,
        participant_scope_id: pId,
        participant_label: pLabel,
        staff_count: Number(jStaffCount || "1"),
        booth_needs: jNeeds.trim(),
        shares_cost: jSharesCost,
        cost_share_thb: jSharesCost && jCostThb ? Number(jCostThb) : null,
        memo_no: jMemoNo.trim() || null,
        contact_name: jContactName.trim(),
        contact_phone: jContactPhone.trim(),
      });
      setJoinTarget(null);
      setJNeeds("");
      showToast(`ส่งคำขอแจมบูธ ${updated.event_code} เรียบร้อยแล้ว`);
      await loadEvents();
      setDetail(updated);
      setDetailTab("joiners");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "ส่งคำขอแจมบูธไม่สำเร็จ");
    } finally {
      setJSubmitting(false);
    }
  }

  async function decideParticipant(participantId: string, decision: "approved" | "declined" | "withdrawn") {
    try {
      const updated = await request<EventDetail>(`v1/admin/events/participants/${participantId}/decision`, "POST", { decision });
      setDetail(updated);
      showToast(decision === "approved" ? "อนุมัติทีมร่วมบูธเรียบร้อยแล้ว" : "อัปเดตสถานะทีมร่วมบูธแล้ว");
      await loadEvents();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "อัปเดตคำขอแจมไม่สำเร็จ");
    }
  }

  async function submitCriticalUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setUSaving(true);
    setErrorMsg(null);
    try {
      const updated = await request<EventDetail>(`v1/admin/events/${detail.id}`, "PUT", {
        expected_revision: detail.revision,
        event_category: detail.event_category,
        title: detail.title,
        venue_name: uVenue.trim(),
        venue_zone: uZone.trim(),
        province: detail.province,
        starts_at: new Date(uStarts).toISOString(),
        ends_at: new Date(uEnds).toISOString(),
        setup_notes: detail.setup_notes,
        host_scope_type: detail.host_scope_type,
        host_scope_id: detail.host_scope_id,
        host_label: detail.host_label,
        partner_org_name: detail.partner_org_name,
        open_for_join: uOpenJoin,
        join_deadline_at: detail.join_deadline_at,
        max_co_joiners: detail.max_co_joiners,
        cost_share_mode: detail.cost_share_mode,
        estimated_cost_thb: detail.estimated_cost_thb,
        memo_no: detail.memo_no,
        campaign_code: uCampaign.trim() || null,
        audience_visibility: detail.audience_visibility,
        contact_name: detail.contact_name,
        contact_phone: detail.contact_phone,
        state: uState,
        change_reason: uReason.trim(),
      });
      setDetail(updated);
      setUReason("");
      showToast("บันทึกการอัปเดตและส่งแจ้งเตือนเช็กชื่อรับทราบถึงทุกทีมที่เกี่ยวข้องแล้ว");
      await loadEvents();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "บันทึกการเปลี่ยนแปลงไม่สำเร็จ (กรุณาระบุเหตุผลการเปลี่ยนแปลง)");
    } finally {
      setUSaving(false);
    }
  }

  async function handleDetailAttachmentUpload(fileList: FileList | null) {
    if (!detail || !fileList?.length) return;
    setDUploading(true);
    setErrorMsg(null);
    try {
      const file = fileList[0];
      const uploaded = await uploadEventAsset(file);
      const updated = await request<EventDetail>(`v1/admin/events/${detail.id}/attachments`, "POST", {
        asset_id: uploaded.id,
        doc_kind: dUploadKind,
        visibility: dUploadKind === "quotation" ? "finance_restricted" : "operational",
        title: uploaded.filename,
        notify_change: dNotifyChange && dUploadKind === "floor_plan",
        change_reason: dNotifyChange ? `อัปเดตผังบูธใหม่ (${uploaded.filename})` : "",
      });
      setDetail(updated);
      showToast("แนบไฟล์เข้าอีเวนต์เรียบร้อยแล้ว");
      await loadEvents();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "แนบไฟล์ไม่สำเร็จ");
    } finally {
      setDUploading(false);
    }
  }

  async function acknowledgeInsideDrawer(ackId: string) {
    try {
      const updated = await request<EventDetail>(`v1/admin/events/alerts/${ackId}/acknowledge`, "POST", {
        note: "ยืนยันรับทราบในหน้าอีเวนต์",
      });
      setDetail(updated);
      showToast("บันทึกการรับทราบเรียบร้อยแล้ว");
      await loadEvents();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "บันทึกการรับทราบไม่สำเร็จ");
    }
  }

  function statusBadge(ev: EventSummary) {
    if (ev.state === "cancelled") return <span className="event-badge tone-danger">ยกเลิกงาน</span>;
    if (ev.state === "postponed") return <span className="event-badge tone-warn">เลื่อนกำหนดการ</span>;
    if (ev.live_status === "live_now") return <span className="event-badge tone-live">กำลังจัดงานวันนี้</span>;
    if (ev.live_status === "upcoming_open") return <span className="event-badge tone-open">เปิดรับทีมแจม</span>;
    if (ev.live_status === "completed") return <span className="event-badge tone-muted">จบงานแล้ว</span>;
    return <span className="event-badge tone-muted">ปิดรับแจม</span>;
  }

  return (
    <HubShell
      section={shellSection}
      staff={staffAllowed}
      roleLabel={account?.display_name_th || (initialRole ? roleLabels[initialRole] : "อีเวนต์เครือ")}
      toolbar={
        localMode && (
          <div className="workspace-home-persona">
            <LocalPersonaPicker initialRole={initialRole} />
          </div>
        )
      }
    >
      <div className="events-workspace">
        <EventChangeBanner onAcknowledged={() => void loadEvents()} />

        {toast && (
          <div
            role="status"
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "12px",
              background: "var(--surface-warm)",
              border: "1.5px solid var(--action)",
              color: "var(--ink)",
              fontWeight: 600,
            }}
          >
            {toast}
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "12px",
              background: "var(--status-danger-soft, #fee2e2)",
              border: "1.5px solid var(--status-danger-strong, #b91c1c)",
              color: "var(--status-danger-strong, #991b1b)",
              fontWeight: 600,
            }}
          >
            {errorMsg}
          </div>
        )}

        <section className="events-hero" aria-label="หัวข้อระบบอีเวนต์เครือ">
          <div>
            <h2>ตลาดกลางดีลอีเวนต์ & บูธเครือเสนา</h2>
            <p>
              ดีลสถานที่จบแล้วลงได้ใน 30 วินาที · ลากไฟล์ผังบูธวางได้ทันที · เปิดให้ทีม Solar, SenX, เงินสดใจดี, LivNex, RentNex หรือโครงการใกล้เคียงกดขอแจม และแจ้งเตือนบังคับกดรับทราบอัตโนมัติเมื่อมีการย้ายโซนหรือยกเลิก
            </p>
          </div>
          <div className="events-hero-actions">
            {refs?.actor.can_write && (
              <button type="button" className="button" style={{ minHeight: "44px" }} onClick={() => setShowCreate(true)}>
                + ลงอีเวนต์ด่วน (30 วินาที)
              </button>
            )}
          </div>
        </section>

        <section className="events-kpis" aria-label="ตัวกรองสถานะอีเวนต์เครือ">
          <button
            type="button"
            className={`events-kpi-btn ${activeFilter === "open_join" ? "is-active" : ""}`}
            onClick={() => setFilterParam("open_join")}
          >
            <span className="events-kpi-label">เปิดรับทีมขอแจม</span>
            <strong className="events-kpi-value">{counts.open_join}</strong>
            <span className="events-kpi-foot">กดขอร่วมบูธ / หารงบได้ทันที</span>
          </button>
          <button
            type="button"
            className={`events-kpi-btn ${activeFilter === "all" ? "is-active" : ""}`}
            onClick={() => setFilterParam("all")}
          >
            <span className="events-kpi-label">อีเวนต์ทั้งหมดในเครือ</span>
            <strong className="events-kpi-value">{counts.all}</strong>
            <span className="events-kpi-foot">รวมทุก BUD · โครงการ · ธุรกิจในเครือ</span>
          </button>
          <button
            type="button"
            className={`events-kpi-btn ${activeFilter === "changed" ? "is-active" : ""}`}
            onClick={() => setFilterParam("changed")}
          >
            <span className="events-kpi-label">ย้ายจุด · เลื่อน · ยกเลิก</span>
            <strong className="events-kpi-value">{counts.changed}</strong>
            <span className="events-kpi-foot">พร้อมระบบเช็กชื่อรับทราบรายทีม</span>
          </button>
          <button
            type="button"
            className={`events-kpi-btn ${activeFilter === "mine" ? "is-active" : ""}`}
            onClick={() => setFilterParam("mine")}
          >
            <span className="events-kpi-label">งานที่ฉันสร้าง / ร่วมแจม</span>
            <strong className="events-kpi-value">{counts.mine}</strong>
            <span className="events-kpi-foot">ดูผังบูธและป้าย QR ของทีมฉัน</span>
          </button>
        </section>

        <div className="events-toolbar">
          <label className="events-toolbar-search">
            ค้นหาอีเวนต์ / สถานที่ / รหัส EVT
            <input
              type="search"
              placeholder="เช่น เซ็นทรัล ลาดพร้าว, เมกาบางนา, EVT-2611, MO2611..."
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
            />
          </label>
          <label>
            กรองตามหน่วยธุรกิจ / โปรแกรม
            <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}>
              <option value="">ทุกหน่วยงานในเครือ</option>
              <option value="business:solar">เสนา โซลาร์ เอนเนอร์ยี่ (SENA Solar)</option>
              <option value="business:senx">เซ็น เอกซ์ (SenX)</option>
              <option value="business:ngernsod_jaidee">เงินสดใจดี</option>
              <option value="programme:LIVNEX">LivNex เช่าออมบ้าน</option>
              <option value="programme:RENTNEX">RentNex เช่าตรงพร้อมอยู่</option>
              <option value="bud">ทีม BUD ที่อยู่อาศัย</option>
              <option value="corporate">การตลาดกลางเครือเสนา</option>
            </select>
          </label>
          {(searchQ || scopeFilter || activeFilter !== "all") && (
            <button
              type="button"
              className="button secondary"
              style={{ minHeight: "44px" }}
              onClick={() => {
                setSearchQ("");
                setScopeFilter("");
                setFilterParam("all");
              }}
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>

        {loading ? (
          <p role="status">กำลังโหลดรายการอีเวนต์เครือ...</p>
        ) : !items.length ? (
          <div className="events-subcard" style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <strong>ไม่พบรายการอีเวนต์ตามเงื่อนไขที่เลือก</strong>
            <p className="event-meta-muted">คุณสามารถกดปุ่ม “+ ลงอีเวนต์ด่วน (30 วินาที)” เพื่อเปิดดีลบูธใหม่ให้ทีมอื่นทราบได้ทันที</p>
          </div>
        ) : (
          <div className="events-grid">
            {items.map(ev => (
              <article
                key={ev.id}
                className={`event-card ${ev.schedule_revision > 1 || ev.state === "postponed" ? "is-changed" : ""} ${
                  ev.state === "cancelled" ? "is-cancelled" : ""
                }`}
              >
                <div style={{ display: "grid", gap: "0.65rem" }}>
                  <div className="event-card-top">
                    <button
                      type="button"
                      className="event-code-chip"
                      title="คลิกเพื่อคัดลอกรหัสอีเวนต์ไปผูกแคมเปญ SENA-H หรือ E-Memo"
                      onClick={() => {
                        void navigator.clipboard?.writeText(ev.event_code);
                        showToast(`คัดลอกรหัส ${ev.event_code} แล้ว`);
                      }}
                    >
                      {ev.event_code}
                    </button>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      {statusBadge(ev)}
                      {ev.schedule_revision > 1 && (
                        <span className="event-badge tone-warn">แก้ไขจุด/เวลา Rev {ev.schedule_revision}</span>
                      )}
                    </div>
                  </div>

                  <h3 className="event-card-title">{ev.title}</h3>

                  <div className="event-meta-list">
                    <div>
                      <strong>สถานที่:</strong> {ev.venue_name}
                      {ev.venue_zone ? ` · ${ev.venue_zone}` : ""} ({ev.province})
                    </div>
                    <div>
                      <strong>วัน-เวลา:</strong> {formatDateRange(ev.starts_at, ev.ends_at)}
                    </div>
                    <div className="event-meta-muted">
                      เจ้าภาพ: <strong>{ev.host_label}</strong> · {categoryLabels[ev.event_category]} · {costModeLabels[ev.cost_share_mode]}
                    </div>
                  </div>

                  <div className="event-join-pills">
                    {ev.has_floor_plan && <span className="event-join-pill">มีไฟล์ผังบูธ</span>}
                    {ev.attachment_count > 0 && <span className="event-join-pill">ไฟล์แนบ {ev.attachment_count}</span>}
                    <span className="event-join-pill">
                      ทีมร่วมแจม {ev.approved_join_count}
                      {ev.max_co_joiners ? `/${ev.max_co_joiners}` : ""}
                    </span>
                    {ev.pending_join_count > 0 && (
                      <span className="event-badge tone-warn">รออนุมัติแจม {ev.pending_join_count}</span>
                    )}
                    {ev.pending_ack_count > 0 && (
                      <span className="event-badge tone-danger">รอรับทราบย้ายจุด {ev.pending_ack_count}</span>
                    )}
                  </div>

                  {ev.joined_labels.length > 0 && (
                    <div className="event-meta-muted">
                      ทีมที่ร่วมออกบูธแล้ว: <strong>{ev.joined_labels.join(" · ")}</strong>
                    </div>
                  )}
                </div>

                <div className="event-card-actions">
                  {ev.state === "scheduled" && ev.open_for_join && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        setJoinTarget(ev);
                        setJSharesCost(ev.cost_share_mode !== "free_invite");
                      }}
                    >
                      ขอแจมบูธนี้
                    </button>
                  )}
                  <button type="button" className="button secondary" onClick={() => void openEventDetail(ev.id)}>
                    ดูผังบูธ · รายละเอียด · QR
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Modal 1: 30-Second Post-Deal Event Create */}
      {showCreate && (
        <div className="events-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="quick-event-title">
          <form className="events-modal" onSubmit={e => void submitQuickCreate(e)}>
            <div className="events-modal-head">
              <div>
                <h3 id="quick-event-title">ลงอีเวนต์ด่วนหลังดีลจบ (ภายใน 30 วินาที)</h3>
                <p className="event-meta-muted" style={{ margin: "0.2rem 0 0" }}>
                  กรอกเฉพาะ 4 ข้อมูลหลัก + แนบไฟล์ผังบูธ/ใบเสนอราคาที่มีอยู่แล้ว ระบบออกรหัส EVT และป้าย QR หน้าบูธให้ทันที
                </p>
              </div>
              <button type="button" className="button secondary" style={{ minHeight: "44px" }} onClick={() => setShowCreate(false)}>
                ปิด
              </button>
            </div>

            <div className="events-dropzone">
              <strong>แนบไฟล์ผังบูธ / ใบเข้าอาคาร / ใบเสนอราคา (PDF หรือรูปภาพ)</strong>
              <span className="event-meta-muted">
                หากยังไม่ได้พิมพ์ชื่องาน ระบบจะดึงชื่อไฟล์มาตั้งชื่องานให้อัตโนมัติ · แยกสิทธิ์ไฟล์ทั่วไปกับไฟล์การเงินชัดเจน
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
                <label className="button secondary" style={{ minHeight: "44px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                  {cUploading ? "กำลังอัปโหลด..." : "+ แนบผังบูธ / ใบเข้าอาคาร (ทุกทีมดูได้)"}
                  <input
                    type="file"
                    accept=".pdf,image/png,image/jpeg,image/webp"
                    multiple
                    hidden
                    disabled={cUploading}
                    onChange={e => void handleQuickFilesSelected(e.target.files, "floor_plan")}
                  />
                </label>
                <label className="button secondary" style={{ minHeight: "44px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                  + แนบใบเสนอราคา / E-Memo (เฉพาะเจ้าภาพ & ทีมหารงบ)
                  <input
                    type="file"
                    accept=".pdf,image/png,image/jpeg,image/webp"
                    multiple
                    hidden
                    disabled={cUploading}
                    onChange={e => void handleQuickFilesSelected(e.target.files, "quotation")}
                  />
                </label>
              </div>
              {cUploads.length > 0 && (
                <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.35rem" }}>
                  {cUploads.map((u, idx) => (
                    <div key={`${u.asset_id}-${idx}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.85rem" }}>
                      <span>
                        {u.visibility === "finance_restricted" ? "🔒 [จำกัดสิทธิ์งบ] " : "📎 [ทุกทีมดูได้] "}
                        <strong>{u.filename}</strong>
                      </span>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setCUploads(prev => prev.filter((_, i) => i !== idx))}
                      >
                        ลบออก
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="events-form-grid">
              <label>
                1. ชื่องาน / ดีลอีเวนต์ *
                <input
                  required
                  placeholder="เช่น ออกบูธ SENA Expo เซ็นทรัล พระราม 9"
                  value={cTitle}
                  onChange={e => setCTitle(e.target.value)}
                />
              </label>
              <label>
                สถานที่จัดงาน (ห้าง / อาคาร / โครงการ) *
                <input
                  required
                  placeholder="เช่น เซ็นทรัล พระราม 9"
                  value={cVenue}
                  onChange={e => setCVenue(e.target.value)}
                />
              </label>
              <label>
                2. จุดตั้งบูธ / ชั้น / โซน
                <input
                  placeholder="เช่น ชั้น 1 ลานโปรโมชั่น โซน A หน้า Starbucks"
                  value={cZone}
                  onChange={e => setCZone(e.target.value)}
                />
              </label>
              <label>
                จังหวัด
                <input value={cProvince} onChange={e => setCProvince(e.target.value)} />
              </label>
              <label>
                3. วัน-เวลาเริ่มงาน *
                <input type="datetime-local" required value={cStarts} onChange={e => setCStarts(e.target.value)} />
              </label>
              <label>
                วัน-เวลาสิ้นสุดงาน *
                <input type="datetime-local" required value={cEnds} onChange={e => setCEnds(e.target.value)} />
              </label>
              <label>
                4. ทีมเจ้าภาพหลัก *
                <select value={cHostKey} onChange={e => setCHostKey(e.target.value)}>
                  {allScopeChoices.map(opt => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                รูปแบบการเปิดให้ทีมอื่นขอแจม
                <select
                  value={cOpenJoin ? cCostMode : "closed"}
                  onChange={e => {
                    if (e.target.value === "closed") {
                      setCOpenJoin(false);
                    } else {
                      setCOpenJoin(true);
                      setCCostMode(e.target.value as EventSummary["cost_share_mode"]);
                    }
                  }}
                >
                  <option value="proportional_split">เปิดรับแจม · หารงบตามสัดส่วน</option>
                  <option value="fixed_slot">เปิดรับแจม · เหมาจ่ายต่อสล็อต</option>
                  <option value="free_invite">เปิดรับแจม · ชวนร่วมบูธฟรี</option>
                  <option value="closed">ปิดรับแจม (แจ้งเพื่อทราบในเครืออย่างเดียว)</option>
                </select>
              </label>
            </div>

            <div>
              <button
                type="button"
                className="button secondary"
                style={{ minHeight: "40px" }}
                onClick={() => setCShowAdvanced(v => !v)}
              >
                {cShowAdvanced ? "ซ่อนรายละเอียดเสริม" : "+ เพิ่มรายละเอียดดีล / เลข E-Memo / รหัสแคมเปญ SENA-H (ไม่บังคับ)"}
              </button>
            </div>

            {cShowAdvanced && (
              <div className="events-form-grid">
                <label>
                  ประเภทงาน
                  <select value={cCategory} onChange={e => setCCategory(e.target.value as EventSummary["event_category"])}>
                    {Object.entries(categoryLabels).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  บริษัทคู่ค้า / ผู้จัดพื้นที่
                  <input placeholder="เช่น CPN, The Mall, บมจ. พันธมิตร" value={cPartner} onChange={e => setCPartner(e.target.value)} />
                </label>
                <label>
                  รับทีมร่วมแจมสูงสุด (ทีม)
                  <input type="number" min={1} max={50} value={cMaxJoiners} onChange={e => setCMaxJoiners(e.target.value)} />
                </label>
                <label>
                  งบค่าพื้นที่รวมโดยประมาณ (บาท · ปกปิดเฉพาะทีมงบ)
                  <input type="number" min={0} placeholder="เช่น 120000" value={cEstCost} onChange={e => setCEstCost(e.target.value)} />
                </label>
                <label>
                  เลข E-Memo อ้างอิง (ถ้ามี)
                  <input placeholder="เช่น MO2611045 หรือ M.COM088_69" value={cMemoNo} onChange={e => setCMemoNo(e.target.value)} />
                </label>
                <label>
                  รหัสแคมเปญโฆษณา SENA-H (ถ้ามียิงแอดเข้าบูธ)
                  <input placeholder="เช่น SN2600412K" value={cCampaignCode} onChange={e => setCCampaignCode(e.target.value)} />
                </label>
                <label>
                  ชื่อผู้ประสานงานหน้างาน
                  <input value={cContactName} onChange={e => setCContactName(e.target.value)} />
                </label>
                <label>
                  เบอร์โทรติดต่อด่วน
                  <input value={cContactPhone} onChange={e => setCContactPhone(e.target.value)} />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  หมายเหตุการเข้าติดตั้งพื้นที่ (เวลาเข้าห้าง / จุดโหลดของ / ระเบียบอาคาร)
                  <textarea
                    rows={2}
                    placeholder="เช่น เข้าติดตั้งหลัง 22:30 น. ประตู Loading B1"
                    value={cSetupNotes}
                    onChange={e => setCSetupNotes(e.target.value)}
                  />
                </label>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
              <button type="button" className="button secondary" style={{ minHeight: "44px" }} onClick={() => setShowCreate(false)}>
                ยกเลิก
              </button>
              <button type="submit" className="button" style={{ minHeight: "44px" }} disabled={cSubmitting || cUploading}>
                {cSubmitting ? "กำลังบันทึก..." : "บันทึกและเปิดประกาศอีเวนต์"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 2: 10-Second Co-Join Request */}
      {joinTarget && (
        <div className="events-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cojoin-modal-title">
          <form className="events-modal" onSubmit={e => void submitCoJoin(e)}>
            <div className="events-modal-head">
              <div>
                <h3 id="cojoin-modal-title">ขอแจมบูธ · {joinTarget.title}</h3>
                <p className="event-meta-muted" style={{ margin: "0.2rem 0 0" }}>
                  {joinTarget.event_code} · {joinTarget.venue_name} {joinTarget.venue_zone ? `(${joinTarget.venue_zone})` : ""} · เจ้าภาพ {joinTarget.host_label}
                </p>
              </div>
              <button type="button" className="button secondary" style={{ minHeight: "44px" }} onClick={() => setJoinTarget(null)}>
                ปิด
              </button>
            </div>

            <div className="events-form-grid">
              <label style={{ gridColumn: "1 / -1" }}>
                เลือกทีม / ธุรกิจ / โครงการที่ขอร่วมออกบูธ *
                <select value={jScopeKey} onChange={e => setJScopeKey(e.target.value)}>
                  {allScopeChoices.map(opt => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                จำนวนเจ้าหน้าที่ประจำบูธ (คน)
                <input type="number" min={1} max={50} value={jStaffCount} onChange={e => setJStaffCount(e.target.value)} />
              </label>
              <label>
                การร่วมแชร์งบค่าพื้นที่
                <select value={jSharesCost ? "yes" : "no"} onChange={e => setJSharesCost(e.target.value === "yes")}>
                  <option value="no">ไม่แชร์งบ / ขอวางสื่อหรือทีมแจมตามคำเชิญ</option>
                  <option value="yes">ร่วมแชร์งบค่าพื้นที่บูธ</option>
                </select>
              </label>
              {jSharesCost && (
                <>
                  <label>
                    งบที่ร่วมแชร์โดยประมาณ (บาท)
                    <input type="number" min={0} placeholder="เช่น 25000" value={jCostThb} onChange={e => setJCostThb(e.target.value)} />
                  </label>
                  <label>
                    เลข E-Memo ฝั่งทีมผู้ขอแจม (ถ้ามี)
                    <input placeholder="เช่น MO2611052" value={jMemoNo} onChange={e => setJMemoNo(e.target.value)} />
                  </label>
                </>
              )}
              <label>
                ผู้ประสานงานของทีมผู้ขอแจม
                <input value={jContactName} onChange={e => setJContactName(e.target.value)} />
              </label>
              <label>
                เบอร์โทรศัพท์ (รับแจ้งเตือนกรณีเปลี่ยนโซน/เลื่อนงาน)
                <input value={jContactPhone} onChange={e => setJContactPhone(e.target.value)} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                อุปกรณ์ / พื้นที่ที่ต้องการใช้งานหน้าบูธ
                <input
                  placeholder="เช่น โต๊ะให้คำปรึกษา 1 ชุด, จุดเสียบปลั๊กไฟ TV, พื้นที่ตั้งป้าย Roll-up 80x200 ซม."
                  value={jNeeds}
                  onChange={e => setJNeeds(e.target.value)}
                />
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
              <button type="button" className="button secondary" style={{ minHeight: "44px" }} onClick={() => setJoinTarget(null)}>
                ยกเลิก
              </button>
              <button type="submit" className="button" style={{ minHeight: "44px" }} disabled={jSubmitting}>
                {jSubmitting ? "กำลังส่งคำขอ..." : "ยืนยันส่งคำขอแจมบูธ"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 3: Event Detail Drawer + Attachments + Co-Join Approval + Change Broadcast + QR Standee */}
      {detail && (
        <div className="events-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="detail-modal-title">
          <div className="events-modal is-wide">
            <div className="events-modal-head">
              <div style={{ display: "grid", gap: "0.3rem" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", alignItems: "center" }}>
                  <code className="event-code-chip">{detail.event_code}</code>
                  <span className="event-badge tone-open">{categoryLabels[detail.event_category]}</span>
                  {detail.schedule_revision > 1 && (
                    <span className="event-badge tone-warn">แก้ไขกำหนดการ/โซน ครั้งที่ {detail.schedule_revision - 1}</span>
                  )}
                  {detail.campaign_code && <span className="event-join-pill">แคมเปญ: {detail.campaign_code}</span>}
                  {detail.memo_no && <span className="event-join-pill">🔒 E-Memo: {detail.memo_no}</span>}
                </div>
                <h3 id="detail-modal-title">{detail.title}</h3>
                <span className="event-meta-muted">
                  สถานที่: <strong>{detail.venue_name}</strong> {detail.venue_zone ? `· ${detail.venue_zone}` : ""} ({detail.province}) · {formatDateRange(detail.starts_at, detail.ends_at)}
                </span>
              </div>
              <button
                type="button"
                className="button secondary"
                style={{ minHeight: "44px" }}
                onClick={() => {
                  setDetail(null);
                  if (selectedEventParam) router.push("/events");
                }}
              >
                ปิดหน้าต่าง
              </button>
            </div>

            <div className="events-tabs" role="tablist" aria-label="หมวดข้อมูลรายละเอียดอีเวนต์">
              <button
                type="button"
                role="tab"
                aria-selected={detailTab === "overview"}
                className={`events-tab-btn ${detailTab === "overview" ? "is-active" : ""}`}
                onClick={() => setDetailTab("overview")}
              >
                ผังบูธ & ไฟล์แนบ ({detail.attachments.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={detailTab === "joiners"}
                className={`events-tab-btn ${detailTab === "joiners" ? "is-active" : ""}`}
                onClick={() => setDetailTab("joiners")}
              >
                ทีมร่วมแจม & หารงบ ({detail.participants.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={detailTab === "changes"}
                className={`events-tab-btn ${detailTab === "changes" ? "is-active" : ""}`}
                onClick={() => setDetailTab("changes")}
              >
                แจ้งย้ายโซน / ยกเลิก & เช็กชื่อรับทราบ ({detail.revisions.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={detailTab === "qr"}
                className={`events-tab-btn ${detailTab === "qr" ? "is-active" : ""}`}
                onClick={() => setDetailTab("qr")}
              >
                ป้าย QR ลงทะเบียนหน้าบูธ
              </button>
            </div>

            {detailTab === "overview" && (
              <div style={{ display: "grid", gap: "1rem" }}>
                <div className="events-subcard">
                  <div className="events-form-grid">
                    <div>
                      <span className="event-meta-muted">ทีมเจ้าภาพ</span>
                      <div><strong>{detail.host_label}</strong></div>
                    </div>
                    <div>
                      <span className="event-meta-muted">ผู้ประสานงานหลัก</span>
                      <div><strong>{detail.contact_name || "-"}</strong> {detail.contact_phone ? `(${detail.contact_phone})` : ""}</div>
                    </div>
                    <div>
                      <span className="event-meta-muted">รูปแบบการแจม</span>
                      <div><strong>{detail.open_for_join ? costModeLabels[detail.cost_share_mode] : "ปิดรับทีมแจมเพิ่ม"}</strong></div>
                    </div>
                    {detail.can_read_finance && detail.estimated_cost_thb != null && (
                      <div>
                        <span className="event-meta-muted">🔒 งบค่าพื้นที่รวม (เฉพาะผู้มีสิทธิ์งบ)</span>
                        <div><strong>{detail.estimated_cost_thb.toLocaleString("th-TH")} บาท</strong></div>
                      </div>
                    )}
                  </div>
                  {detail.setup_notes && (
                    <div>
                      <span className="event-meta-muted">คำแนะนำการเข้าพื้นที่ / ติดตั้งบูธ:</span>
                      <div style={{ marginTop: "0.2rem" }}>{detail.setup_notes}</div>
                    </div>
                  )}
                </div>

                <div className="events-subcard">
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                    <strong>ไฟล์แนบประจำงาน ({detail.attachments.length})</strong>
                    {detail.can_manage && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                        <select
                          aria-label="ประเภทเอกสารแนบเพิ่ม"
                          value={dUploadKind}
                          onChange={e => setDUploadKind(e.target.value as EventAttachment["doc_kind"])}
                          style={{ minHeight: "40px", borderRadius: "8px", padding: "0 0.5rem" }}
                        >
                          {Object.entries(docKindLabels).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                        {dUploadKind === "floor_plan" && (
                          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem" }}>
                            <input type="checkbox" checked={dNotifyChange} onChange={e => setDNotifyChange(e.target.checked)} />
                            แจ้งเตือนทุกทีมว่าผังบูธเปลี่ยน
                          </label>
                        )}
                        <label className="button secondary" style={{ minHeight: "40px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                          {dUploading ? "กำลังอัปโหลด..." : "+ อัปโหลดไฟล์เพิ่ม"}
                          <input
                            type="file"
                            accept=".pdf,image/png,image/jpeg,image/webp"
                            hidden
                            disabled={dUploading}
                            onChange={e => void handleDetailAttachmentUpload(e.target.files)}
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {!detail.attachments.length ? (
                    <p className="event-meta-muted" style={{ margin: 0 }}>ยังไม่มีไฟล์แนบในอีเวนต์นี้</p>
                  ) : (
                    <div style={{ display: "grid", gap: "0.5rem" }}>
                      {detail.attachments.map(att => (
                        <div
                          key={att.id}
                          style={{
                            background: "var(--surface)",
                            border: "1px solid var(--line-strong)",
                            borderRadius: "10px",
                            padding: "0.7rem 0.9rem",
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "0.6rem",
                          }}
                        >
                          <div style={{ display: "grid", gap: "0.18rem" }}>
                            <div>
                              <span className={`event-badge ${att.visibility === "finance_restricted" ? "tone-warn" : "tone-open"}`} style={{ marginRight: "0.45rem" }}>
                                {att.visibility === "finance_restricted" ? "🔒 เฉพาะเจ้าภาพ/ทีมหารงบ" : "เปิดให้พนักงานในเครือดูได้"}
                              </span>
                              <strong>{att.title}</strong> <span className="event-meta-muted">(v{att.version_no})</span>
                            </div>
                            <span className="event-meta-muted">
                              {docKindLabels[att.doc_kind]} · {att.original_filename} · {Math.max(1, Math.round(att.file_size / 1024))} KB
                            </span>
                          </div>
                          <a
                            href={att.download_url}
                            target="_blank"
                            rel="noreferrer"
                            className="button secondary"
                            style={{ minHeight: "40px", display: "inline-flex", alignItems: "center" }}
                          >
                            เปิดดู / ดาวน์โหลดไฟล์
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {detailTab === "joiners" && (
              <div style={{ display: "grid", gap: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                  <strong>รายชื่อทีมที่ขอแจมบูธ ({detail.participants.length})</strong>
                  {detail.state === "scheduled" && detail.open_for_join && (
                    <button
                      type="button"
                      className="button"
                      style={{ minHeight: "42px" }}
                      onClick={() => {
                        setJoinTarget({
                          ...detail,
                          approved_join_count: detail.participants.filter(p => p.join_state === "approved").length,
                          pending_join_count: detail.participants.filter(p => p.join_state === "requested").length,
                          pending_ack_count: 0,
                          joined_labels: [],
                          attachment_count: detail.attachments.length,
                          has_floor_plan: detail.attachments.some(a => a.doc_kind === "floor_plan"),
                        });
                      }}
                    >
                      + ส่งคำขอแจมบูธนี้เพิ่ม
                    </button>
                  )}
                </div>

                {!detail.participants.length ? (
                  <div className="events-subcard">
                    <p className="event-meta-muted" style={{ margin: 0 }}>ยังไม่มีทีมส่งคำขอแจมในงานนี้ กดปุ่ม “+ ส่งคำขอแจมบูธนี้เพิ่ม” เพื่อประเดิมร่วมบูธได้ทันที</p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: "0.65rem" }}>
                    {detail.participants.map(p => (
                      <div
                        key={p.id}
                        className="events-subcard"
                        style={{ background: "var(--surface)", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}
                      >
                        <div style={{ display: "grid", gap: "0.25rem" }}>
                          <div style={{ display: "flex", gap: "0.45rem", alignItems: "center", flexWrap: "wrap" }}>
                            <strong>{p.participant_label}</strong>
                            <span
                              className={`event-badge ${
                                p.join_state === "approved"
                                  ? "tone-open"
                                  : p.join_state === "requested"
                                    ? "tone-warn"
                                    : "tone-muted"
                              }`}
                            >
                              {p.join_state === "approved"
                                ? "อนุมัติร่วมบูธแล้ว"
                                : p.join_state === "requested"
                                  ? "รอเจ้าภาพอนุมัติ"
                                  : p.join_state === "declined"
                                    ? "ไม่ผ่านการอนุมัติ"
                                    : "ถอนคำขอแล้ว"}
                            </span>
                            <span className="event-join-pill">ทีมงาน {p.staff_count} คน</span>
                            {p.cost_share_thb != null && (
                              <span className="event-join-pill">🔒 ร่วมแชร์งบ {p.cost_share_thb.toLocaleString("th-TH")} บาท</span>
                            )}
                          </div>
                          {p.booth_needs && <div style={{ fontSize: "0.88rem" }}>ความต้องการหน้าบูธ: {p.booth_needs}</div>}
                          <div className="event-meta-muted">
                            ผู้ติดต่อ: {p.contact_name || "-"} {p.contact_phone ? `(${p.contact_phone})` : ""}
                            {p.decision_note ? ` · หมายเหตุเจ้าภาพ: ${p.decision_note}` : ""}
                          </div>
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
                          {detail.can_manage && p.join_state === "requested" && (
                            <>
                              <button type="button" className="button" style={{ minHeight: "40px" }} onClick={() => void decideParticipant(p.id, "approved")}>
                                อนุมัติให้แจม
                              </button>
                              <button type="button" className="button secondary" style={{ minHeight: "40px" }} onClick={() => void decideParticipant(p.id, "declined")}>
                                ปฏิเสธ
                              </button>
                            </>
                          )}
                          {p.join_state === "approved" && (
                            <button
                              type="button"
                              className="button secondary"
                              style={{ minHeight: "40px" }}
                              onClick={() => {
                                setSelectedQrUrl(p.qr_registration_url);
                                setSelectedQrLabel(`${detail.event_code} · ทีมร่วมแจม (${p.participant_label})`);
                                setDetailTab("qr");
                              }}
                            >
                              ป้าย QR เฉพาะทีมนี้
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {detailTab === "changes" && (
              <div style={{ display: "grid", gap: "1rem" }}>
                {detail.can_manage && (
                  <form className="events-subcard" onSubmit={e => void submitCriticalUpdate(e)}>
                    <strong>อัปเดตย้ายโซน / เปลี่ยนวัน-เวลา / เลื่อนหรือยกเลิกงาน (ส่งแจ้งเตือนบังคับรับทราบ)</strong>
                    <div className="events-form-grid">
                      <label>
                        สถานะการจัดงาน
                        <select value={uState} onChange={e => setUState(e.target.value as EventSummary["state"])}>
                          <option value="scheduled">จัดงานตามกำหนดปกติ</option>
                          <option value="postponed">เลื่อนกำหนดจัดงานชั่วคราว</option>
                          <option value="cancelled">ยกเลิกการจัดงาน</option>
                        </select>
                      </label>
                      <label>
                        เปิดรับทีมขอแจมเพิ่ม
                        <select value={uOpenJoin ? "open" : "closed"} onChange={e => setUOpenJoin(e.target.value === "open")}>
                          <option value="open">เปิดรับแจม</option>
                          <option value="closed">ปิดรับแจมแล้ว</option>
                        </select>
                      </label>
                      <label>
                        สถานที่จัดงาน
                        <input required value={uVenue} onChange={e => setUVenue(e.target.value)} />
                      </label>
                      <label>
                        จุดตั้งบูธ / ชั้น / โซนล่าสุด
                        <input value={uZone} onChange={e => setUZone(e.target.value)} />
                      </label>
                      <label>
                        วัน-เวลาเริ่มใหม่
                        <input type="datetime-local" required value={uStarts} onChange={e => setUStarts(e.target.value)} />
                      </label>
                      <label>
                        วัน-เวลาสิ้นสุดใหม่
                        <input type="datetime-local" required value={uEnds} onChange={e => setUEnds(e.target.value)} />
                      </label>
                      <label>
                        รหัสแคมเปญ SENA-H (แจ้งเตือนทีม Online Ads อัตโนมัติ)
                        <input placeholder="เช่น SN2600412K" value={uCampaign} onChange={e => setUCampaign(e.target.value)} />
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        เหตุผลการย้ายจุด / เลื่อน / ยกเลิก (บังคับกรอกเมื่อเปลี่ยนสถานที่ เวลา หรือสถานะ) *
                        <input
                          placeholder="เช่น ห้างแจ้งย้ายจุดโปรโมชั่นลงมาชั้น G หน้าลิฟต์แก้ว เริ่มเข้าพื้นที่ 22:30 น."
                          value={uReason}
                          onChange={e => setUReason(e.target.value)}
                        />
                      </label>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button type="submit" className="button" style={{ minHeight: "44px" }} disabled={uSaving}>
                        {uSaving ? "กำลังบันทึกและส่งแจ้งเตือน..." : "บันทึกการเปลี่ยนแปลง & ส่งเช็กชื่อรับทราบทุกทีม"}
                      </button>
                    </div>
                  </form>
                )}

                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <strong>ประวัติการเปลี่ยนแปลงและใบเช็กชื่อรับทราบ ({detail.revisions.length})</strong>
                  {!detail.revisions.length ? (
                    <p className="event-meta-muted" style={{ margin: 0 }}>อีเวนต์นี้ยังไม่มีการเปลี่ยนแปลงสถานที่หรือกำหนดการ</p>
                  ) : (
                    detail.revisions.map(rev => (
                      <div key={rev.id} className="events-subcard" style={{ background: "var(--surface)" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                          <span className="event-badge tone-warn">Revision {rev.schedule_revision}</span>
                          <strong>เหตุผล: {rev.change_reason}</strong>
                        </div>
                        <div style={{ display: "grid", gap: "0.45rem", marginTop: "0.3rem" }}>
                          {rev.acknowledgements.map(ack => (
                            <div
                              key={ack.id}
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: "0.5rem",
                                padding: "0.55rem 0.75rem",
                                borderRadius: "8px",
                                background: "var(--canvas)",
                              }}
                            >
                              <div>
                                <strong>{ack.target_label}</strong>{" "}
                                <span className="event-meta-muted">
                                  ({ack.contact_name || "ผู้รับผิดชอบ"} {ack.contact_phone ? `· ${ack.contact_phone}` : ""})
                                </span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                {ack.acked_at ? (
                                  <span className="event-badge tone-open">รับทราบแล้ว</span>
                                ) : (
                                  <>
                                    <span className="event-badge tone-danger">รอกดรับทราบ</span>
                                    {ack.can_ack && (
                                      <button
                                        type="button"
                                        className="button"
                                        style={{ minHeight: "38px" }}
                                        onClick={() => void acknowledgeInsideDrawer(ack.id)}
                                      >
                                        กดรับทราบ
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {detailTab === "qr" && (
              <div style={{ display: "grid", gap: "1rem" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", alignItems: "center" }}>
                  <span className="event-meta-muted">เลือกป้าย QR ประจำบูธ:</span>
                  <button
                    type="button"
                    className={`events-tab-btn ${selectedQrUrl === detail.qr_registration_url ? "is-active" : ""}`}
                    onClick={() => {
                      setSelectedQrUrl(detail.qr_registration_url);
                      setSelectedQrLabel(`${detail.event_code} · บูธหลัก (${detail.host_label})`);
                    }}
                  >
                    บูธหลัก ({detail.host_label})
                  </button>
                  {detail.participants
                    .filter(p => p.join_state === "approved")
                    .map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className={`events-tab-btn ${selectedQrUrl === p.qr_registration_url ? "is-active" : ""}`}
                        onClick={() => {
                          setSelectedQrUrl(p.qr_registration_url);
                          setSelectedQrLabel(`${detail.event_code} · ทีมร่วมแจม (${p.participant_label})`);
                        }}
                      >
                        {p.participant_label}
                      </button>
                    ))}
                </div>

                <div className="events-standee-preview">
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.04em", color: "#08786e" }}>
                    SENA DEVELOPMENT · EVENT REGISTRATION
                  </div>
                  <div style={{ fontWeight: 700, fontSize: "1.02rem" }}>{detail.title}</div>
                  <QrCodeSvg url={selectedQrUrl || detail.qr_registration_url} size={204} />
                  <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>{selectedQrLabel}</div>
                  <div style={{ fontSize: "0.76rem", color: "#43645f" }}>
                    {detail.venue_name} {detail.venue_zone ? `· ${detail.venue_zone}` : ""}
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.6rem" }}>
                  <button
                    type="button"
                    className="button"
                    style={{ minHeight: "44px" }}
                    onClick={() => {
                      void navigator.clipboard?.writeText(selectedQrUrl || detail.qr_registration_url);
                      showToast("คัดลอกลิงก์ UTM ลงทะเบียนหน้าบูธแล้ว");
                    }}
                  >
                    คัดลอกลิงก์ลงทะเบียน (พร้อม UTM)
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    style={{ minHeight: "44px" }}
                    onClick={() => {
                      void navigator.clipboard?.writeText(detail.event_code);
                      showToast(`คัดลอกรหัส ${detail.event_code} สำหรับแนบ E-Memo / SENA-H แล้ว`);
                    }}
                  >
                    คัดลอกรหัส {detail.event_code} ผูก E-Memo / แคมเปญ
                  </button>
                  <button type="button" className="button secondary" style={{ minHeight: "44px" }} onClick={() => window.print()}>
                    พิมพ์ป้าย QR ตั้งโต๊ะหน้าบูธ
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </HubShell>
  );
}
