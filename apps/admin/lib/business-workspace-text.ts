// UI copy is copied from the canonical catalogue in docs/47.
import { workspaceText } from "./unified-workspace";

export const businessWorkspaceText = {
  business: workspaceText.business,
  data: workspaceText.data,
  narrative: "เนื้อหาธุรกิจ",
  contacts: "ช่องทางติดต่อ",
  english: "ภาษาอังกฤษ",
  noApplicablePhases: "ยังไม่ได้ระบุโครงการหรือเฟสที่ใช้คำตอบนี้",
  loading: "กำลังโหลดข้อมูล…",
  retry: "ลองใหม่",
  loadError: "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่",
  permissionRequired: "ไม่มีสิทธิ์ดำเนินการนี้",
} as const;
