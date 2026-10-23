export const facilityGroups: Record<string, string> = { other: "อื่นๆ", service: "บริการ", work: "ทำงาน", recreation: "นันทนาการ", landscape: "พื้นที่สีเขียว", wellness: "สุขภาวะ" };
export const facilityIcons: Record<string, string> = { building: "อาคาร", users: "พื้นที่ใช้ร่วมกัน", leaf: "ต้นไม้", sun: "พื้นที่กลางแจ้ง", activity: "กีฬา", flame: "ความร้อน", film: "ภาพยนตร์", flag: "สนาม", shopping_bag: "ร้านค้า", mail: "จดหมาย" };
const paths: Record<string, string> = {
  building: "M4 21V3h12v18M8 7h4M8 11h4M8 15h4M16 9h4v12M2 21h20",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  leaf: "M20 4C9 2 2 9 6 16s14 2 14-12ZM4 21 16 9",
  sun: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  activity: "M2 12h4l3-8 6 16 3-8h4",
  flame: "M12 3c1 5 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 0 4 3 4 3-4Z",
  film: "M3 3h18v18H3ZM7 3v18M17 3v18M3 7h4M3 12h4M3 17h4M17 7h4M17 12h4M17 17h4",
  flag: "M5 21V3c5-4 9 4 14 0v10c-5 4-9-4-14 0",
  shopping_bag: "M4 7h16l1 14H3ZM8 7V5a4 4 0 0 1 8 0v2",
  mail: "M3 5h18v14H3ZM3 5l9 7 9-7",
};
export function FacilityIcon({ code }: { code: string }) {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[code] ?? paths.building} /></svg>;
}
