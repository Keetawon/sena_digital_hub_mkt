export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/hub/${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const json = await response.json().catch(() => null);
  if (json?.error?.invalidate_access === true && typeof window !== "undefined") window.dispatchEvent(new Event("hub-content-access-invalidated"));
  if (!response.ok) {
    const error = new Error(json?.error?.message ?? "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง") as Error & { status?: number; code?: string; details?: unknown };
    error.status = response.status;
    error.code = json?.error?.code;
    error.details = json?.error?.details;
    throw error;
  }
  return json.data;
}
