import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * There was no way to sign out at all, which is half of why every email
 * appeared to show the same dashboard: the first session established in a
 * browser was the only one it ever had.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login", request.url), {
    // 303 so the browser follows with GET rather than re-POSTing.
    status: 303,
  });
}
