import { NextRequest, NextResponse } from "next/server";
import { cookieName, getRoleToken, hasSameLocalOrigin, isLocalMode, localRequestOrigin, LocalRole, localPersonas } from "@/lib/local-session";

export async function POST(request: NextRequest) {
  if (!isLocalMode() || !localRequestOrigin(request)) {
    return NextResponse.json({ error: { message: "บัญชีทดสอบเปิดใช้ได้เฉพาะเครื่องพัฒนาเท่านั้น" } }, { status: 403 });
  }
  if (!hasSameLocalOrigin(request)) {
    return NextResponse.json({ error: { message: "ไม่อนุญาตคำขอจากต้นทางนี้" } }, { status: 403 });
  }
  let role: LocalRole;
  try {
    const body = await request.json();
    role = body.role;
  } catch {
    return NextResponse.json({ error: { message: "รูปแบบข้อมูลไม่ถูกต้อง" } }, { status: 400 });
  }
  if (!(localPersonas as readonly string[]).includes(role!) || !getRoleToken(role!)) {
    return NextResponse.json({ error: { message: "ยังไม่ได้ตั้งค่าบัญชีทดสอบนี้บนเซิร์ฟเวอร์" } }, { status: 400 });
  }
  const response = NextResponse.json({ role });
  response.cookies.set(cookieName, role, { httpOnly: true, sameSite: "strict", path: "/", secure: false });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
