import { createHash } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { HubApiUnavailable } from "./hub-account";

const VERIFIED_TTL_MS = 1_500;
const MAX_ENTRIES = 64;

const inFlight = new Map<string, Promise<User | null>>();
const recentVerified = new Map<string, { user: User; expiresAt: number }>();

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyHostedAccessToken(
  client: SupabaseClient,
  token: string,
  simulation: boolean
): Promise<User | null> {
  if (!token) return null;
  const key = tokenDigest(token);
  const now = Date.now();

  if (!simulation) {
    const hit = recentVerified.get(key);
    if (hit && hit.expiresAt > now) return hit.user;
    if (hit) recentVerified.delete(key);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const lookup = (async () => {
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error && (!error.status || error.status >= 500)) throw new HubApiUnavailable();
    if (error || !user) {
      recentVerified.delete(key);
      return null;
    }
    if (!simulation) {
      if (recentVerified.size >= MAX_ENTRIES) {
        const oldest = recentVerified.keys().next().value;
        if (oldest) recentVerified.delete(oldest);
      }
      recentVerified.set(key, { user, expiresAt: Date.now() + VERIFIED_TTL_MS });
    }
    return user;
  })();

  inFlight.set(key, lookup);
  try {
    return await lookup;
  } finally {
    inFlight.delete(key);
  }
}
