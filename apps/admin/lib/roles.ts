export const roles = ["editor", "publisher", "viewer", "admin", "online_staff", "agency_kin", "agency_combay"] as const;
export const uatRoles = ["uat_admin", "uat_suspended", "uat_somchai"] as const;
export const localPersonas = [...roles, ...uatRoles] as const;
// Local selectors identify synthetic accounts; permissions always come from /me.
export type LocalRole = (typeof localPersonas)[number] | "agency";
export const roleLabels: Record<LocalRole, string> = {
  editor: "ผู้แก้ไขข้อมูล",
  publisher: "Manager · อนุมัติและเผยแพร่",
  viewer: "ผู้อ่านข้อมูล",
  admin: "ผู้ดูแลระบบ",
  online_staff: "ทีมออนไลน์",
  agency: "เอเจนซี",
  agency_kin: "เอเจนซี KIN",
  agency_combay: "เอเจนซี COMBAY",
  uat_admin: "ผู้ดูแลสำรอง (UAT)",
  uat_suspended: "บัญชีระงับ (UAT)",
  uat_somchai: "สมชาย ทดสอบ",
};
