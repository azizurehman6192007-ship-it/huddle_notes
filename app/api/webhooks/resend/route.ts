import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * §10: keep email_log in step with reality so a bad address is visible.
 *
 * Auth is a shared secret in the query string rather than Resend's Svix
 * signature, which would mean pulling in the `svix` package. Configure the
 * endpoint as /api/webhooks/resend?key=<RESEND_WEBHOOK_SECRET>. With no secret
 * set this route rejects everything — it fails closed, not open.
 */
const STATUS_BY_EVENT: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export async function POST(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = (await request.json()) as typeof event;
  } catch {
    return NextResponse.json({ error: "Bad payload." }, { status: 400 });
  }

  const status = event.type ? STATUS_BY_EVENT[event.type] : undefined;
  const providerId = event.data?.email_id;

  // Unknown event types are fine — acknowledge so Resend stops retrying.
  if (!status || !providerId) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const { error } = await admin
    .from("email_log")
    .update({ status })
    .eq("provider_id", providerId);

  if (error) {
    console.error("email_log update failed", { providerId, status, error });
    return NextResponse.json({ error: "Update failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function isAuthorised(request: Request): boolean {
  const expected = process.env.RESEND_WEBHOOK_SECRET ?? "";
  if (!expected) return false;

  const presented = new URL(request.url).searchParams.get("key") ?? "";
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
