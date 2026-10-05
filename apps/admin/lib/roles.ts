export const roles = ["editor", "publisher", "viewer", "admin", "online_staff", "agency_kin", "agency_combay"] as const;
export type LocalRole = (typeof roles)[number];
export const roleLabels: Record<LocalRole, string> = {
  editor: "ผู้แก้ไขข้อมูล",
  publisher: "ผู้เผยแพร่",
  viewer: "ผู้อ่านข้อมูล",
  admin: "ผู้ดูแลระบบ",
  online_staff: "ทีมออนไลน์",
  agency_kin: "เอเจนซี KIN",
  agency_combay: "เอเจนซี COMBAY",
};
