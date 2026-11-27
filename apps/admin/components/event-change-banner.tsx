"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { can, canWorkspace } from "@/lib/hub-permissions";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";

export type EventAlertItem = {
  ack_id: string;
  event_id: string;
  event_code: string;
  event_title: string;
  state: "scheduled" | "postponed" | "cancelled";
  venue_name: string;
  venue_zone: string;
  starts_at: string;
  ends_at: string;
  schedule_revision: number;
  change_type: "venue_changed" | "time_changed" | "postponed" | "cancelled" | "reopened" | "floor_plan_updated";
  change_reason: string;
  before_snapshot?: Record<string, unknown>;
  after_snapshot?: Record<string, unknown>;
  target_kind: "participant" | "online_ads";
  target_label: string;
  changed_at: string;
};

const changeTypeLabel: Record<EventAlertItem["change_type"], string> = {
  venue_changed: "ย้ายสถานที่ / จุดตั้งบูธ",
  time_changed: "เปลี่ยนวัน-เวลาจัดงาน",
  postponed: "เลื่อนกำหนดจัดงาน",
  cancelled: "ยกเลิกการจัดอีเวนต์",
  reopened: "กลับมาเปิดจัดงานตามปกติ",
  floor_plan_updated: "อัปเดตผังบูธฉบับใหม่",
};

function formatShortDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
      timeZone: "Asia/Bangkok",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function EventChangeBanner({ onAcknowledged }: { onAcknowledged?: () => void }) {
  const { account } = useHubPermissions();
  const [items, setItems] = useState<EventAlertItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const eligible =
    Boolean(account) &&
    account?.status === "ACTIVE" &&
    !account?.agency &&
    !account?.agency_code &&
    (canWorkspace(account?.capabilities) ||
      can(account?.capabilities, "registry") ||
      can(account?.capabilities, "finance"));

  useEffect(() => {
    if (!eligible) {
      setItems([]);
      return;
    }
    let active = true;
    request<{ items?: EventAlertItem[] }>("v1/admin/events/alerts?only_mine=true")
      .then(res => {
        if (active && Array.isArray(res?.items)) {
          setItems(res.items);
        }
      })
      .catch(() => {
        // Fail silently so mocked page tests without /events/alerts remain unaffected
      });
    return () => {
      active = false;
    };
  }, [eligible, account?.id]);

  async function acknowledge(ackId: string) {
    setBusyId(ackId);
    try {
      await request(`v1/admin/events/alerts/${ackId}/acknowledge`, "POST", {
        note: "รับทราบผ่านแบนเนอร์แจ้งเตือนด่วน",
      });
      setItems(current => current.filter(item => item.ack_id !== ackId));
      onAcknowledged?.();
    } catch {
      // Keep item visible if request fails
    } finally {
      setBusyId(null);
    }
  }

  if (!items.length) return null;

  return (
    <section
      aria-label="แจ้งเตือนการเปลี่ยนแปลงอีเวนต์เครือ"
      style={{
        marginBottom: "1rem",
        padding: "0.95rem 1.1rem",
        borderRadius: "14px",
        border: "1.5px solid var(--status-warning-strong, #b45309)",
        background: "var(--status-warning-soft, #fef3c7)",
        color: "var(--ink)",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", fontWeight: 700 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.2rem 0.6rem",
              borderRadius: "999px",
              fontSize: "0.8rem",
              background: "var(--status-danger-strong, #b91c1c)",
              color: "#fff",
            }}
          >
            ด่วน · {items.length} รายการรอยืนยันรับทราบ
          </span>
          <span>แจ้งเปลี่ยนแปลงสถานที่ / กำหนดการอีเวนต์เครือเสนา</span>
        </div>
        <Link prefetch={false} href="/events?filter=changed" className="button secondary" style={{ minHeight: "40px" }}>
          เปิดหน้าอีเวนต์เครือทั้งหมด
        </Link>
      </div>

      <div style={{ display: "grid", gap: "0.65rem" }}>
        {items.map(alert => {
          const beforeZone = String(alert.before_snapshot?.venue_zone ?? "");
          const afterZone = String(alert.after_snapshot?.venue_zone ?? alert.venue_zone ?? "");
          return (
            <div
              key={alert.ack_id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--line-strong)",
                borderRadius: "12px",
                padding: "0.85rem 1rem",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.85rem",
              }}
            >
              <div style={{ display: "grid", gap: "0.28rem", minWidth: "240px", flex: "1 1 420px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.45rem" }}>
                  <code style={{ fontWeight: 700, fontSize: "0.82rem" }}>{alert.event_code}</code>
                  <span
                    style={{
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      padding: "0.14rem 0.5rem",
                      borderRadius: "999px",
                      background:
                        alert.state === "cancelled"
                          ? "var(--status-danger-soft, #fee2e2)"
                          : "var(--surface-warm)",
                      color:
                        alert.state === "cancelled"
                          ? "var(--status-danger-strong, #991b1b)"
                          : "var(--action)",
                    }}
                  >
                    {changeTypeLabel[alert.change_type] ?? alert.change_type} (Rev {alert.schedule_revision})
                  </span>
                  <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                    แจ้งถึง: <strong>{alert.target_label}</strong>
                  </span>
                </div>
                <strong style={{ fontSize: "0.98rem" }}>{alert.event_title}</strong>
                <div style={{ fontSize: "0.88rem", color: "var(--ink)" }}>
                  <span>
                    สถานที่ล่าสุด: <strong>{alert.venue_name}</strong>
                    {afterZone ? ` · ${afterZone}` : ""} ({formatShortDate(alert.starts_at)} – {formatShortDate(alert.ends_at)})
                  </span>
                  {beforeZone && beforeZone !== afterZone && (
                    <span style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)" }}>
                      เดิม: {beforeZone} → ใหม่: <strong>{afterZone}</strong>
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                  เหตุผล: {alert.change_reason}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                <Link
                  prefetch={false}
                  href={`/events?event=${encodeURIComponent(alert.event_id)}`}
                  className="button secondary"
                  style={{ minHeight: "44px", display: "inline-flex", alignItems: "center" }}
                >
                  ดูผังบูธ / รายละเอียด
                </Link>
                <button
                  type="button"
                  className="button"
                  disabled={busyId === alert.ack_id}
                  onClick={() => void acknowledge(alert.ack_id)}
                  style={{
                    minHeight: "44px",
                    background: "var(--action)",
                    color: "var(--surface)",
                    border: "1px solid var(--action)",
                    borderRadius: "10px",
                    fontWeight: 700,
                    padding: "0.5rem 1rem",
                    cursor: "pointer",
                  }}
                >
                  {busyId === alert.ack_id ? "กำลังบันทึก..." : "รับทราบการเปลี่ยนแปลง"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
