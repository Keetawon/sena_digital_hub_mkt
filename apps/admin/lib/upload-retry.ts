const RETRY_WINDOW_MS = 60_000;

function retryDelay(header: string | null): number {
  if (header === null) return 1000;
  const value = header.trim();
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isNaN(delay) ? 1000 : Math.max(1000, delay);
}

export async function retryBusyUpload(send: () => Promise<Response>, onWaiting?: (waiting: boolean) => void): Promise<Response> {
  let response = await send();
  if (response.status !== 429) return response;
  const deadline = performance.now() + RETRY_WINDOW_MS;
  onWaiting?.(true);
  try {
    while (response.status === 429) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(retryDelay(response.headers.get("Retry-After")), remaining)));
      if (performance.now() >= deadline) break;
      await response.body?.cancel();
      response = await send();
    }
    return response;
  } finally {
    onWaiting?.(false);
  }
}
