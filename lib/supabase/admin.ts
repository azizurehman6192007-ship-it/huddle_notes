import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for routes that have already authorised the caller themselves, and for
 * the worker (which has no user session at all). `server-only` makes importing
 * this from a client component a build error rather than a leak.
 */
export function createAdminClient() {
  return createClient<Database>(
    publicEnv.supabaseUrl(),
    serverEnv.serviceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export const AUDIO_BUCKET = "meeting-audio";
export const PDF_BUCKET = "meeting-pdfs";
