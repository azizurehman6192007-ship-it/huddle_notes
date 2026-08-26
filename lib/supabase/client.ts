"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.supabaseUrl(),
    publicEnv.supabaseAnonKey(),
  );
}
