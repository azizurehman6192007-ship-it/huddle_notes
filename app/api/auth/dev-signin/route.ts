import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * ⚠️  UNVERIFIED SIGN-IN — INTERNAL TESTING ONLY. NOT SAFE FOR REAL USERS.  ⚠️
 *
 * This route hands out a full session to anyone who can type an email address.
 * There is no proof the caller owns it: no magic link, no OTP, no password, no
 * OAuth. Typing a colleague's address here logs you in as them and shows you
 * their team's huddles, transcripts and notes.
 *
 * It exists so internal testing doesn't have to round-trip through email while
 * the rest of the product is being built. Before this touches real external
 * users or anything confidential, `signInWithOtp` (email OTP) or a Google
 * provider must be restored in front of it and this route deleted. See the
 * "Auth is switched off" section of README.md.
 *
 * Why a real Supabase session rather than a cookie of our own: every page and
 * route in the app reads through RLS, and the policies key off
 * `auth.jwt() ->> 'email'`. Minting a genuine session keeps RLS, `auth.uid()`,
 * `meetings.created_by` and `create_team()` working exactly as they do under
 * real auth, so restoring verification later is a change to this one file
 * rather than to the whole data layer.
 *
 * In production the door is bolted unless someone opens it on purpose: an
 * accidental deploy fails closed instead of silently shipping an open login.
 */
function bypassAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ALLOW_UNVERIFIED_SIGNIN === "true";
}

interface SignInBody {
  email?: string;
}

export async function POST(request: Request) {
  if (!bypassAllowed()) {
    return NextResponse.json(
      {
        error:
          "Unverified sign-in is off in production. Restore real verification, or set ALLOW_UNVERIFIED_SIGNIN=true if this is a staging box.",
      },
      { status: 403 },
    );
  }

  let body: SignInBody;
  try {
    body = (await request.json()) as SignInBody;
  } catch {
    body = {};
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json(
      { error: "That doesn't look like an email address." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // The fix for "every email showed the same dashboard": the previous session
  // is torn down before a new one is minted. Without this, the cookie from
  // whoever signed in first survives and keeps answering for everybody.
  await supabase.auth.signOut({ scope: "local" });

  const admin = createAdminClient();

  // First time this address is seen: create the auth user outright. Admin
  // creation bypasses the project's sign-up toggle, so a closed project still
  // works for internal testing.
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (createError && !isAlreadyRegistered(createError)) {
    console.error("dev-signin: createUser failed", createError);
    return NextResponse.json(
      { error: `Couldn't set up that account: ${createError.message}` },
      { status: 500 },
    );
  }

  // generateLink does NOT send mail — it returns the token we would have
  // emailed. Redeeming it ourselves is what makes this instant.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("dev-signin: generateLink failed", linkError);
    return NextResponse.json(
      { error: `Couldn't sign in: ${linkError?.message ?? "no token issued"}` },
      { status: 500 },
    );
  }

  // GoTrue has accepted both labels for a magic-link hash across versions;
  // try the specific one, fall back to the generic rather than dead-ending.
  const verified = await verify(supabase, tokenHash, "magiclink");
  const outcome = verified ?? (await verify(supabase, tokenHash, "email"));

  if (!outcome) {
    return NextResponse.json(
      { error: "Couldn't start a session for that address. Try again." },
      { status: 500 },
    );
  }

  console.warn(
    `[auth] UNVERIFIED sign-in as ${email} — no ownership check was performed.`,
  );

  return NextResponse.json({ ok: true, email });
}

/** Sets the session cookies as a side effect when it succeeds. */
async function verify(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tokenHash: string,
  type: EmailOtpType,
): Promise<true | null> {
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });
  if (error) {
    console.error(`dev-signin: verifyOtp(${type}) failed`, error);
    return null;
  }
  return true;
}

function isAlreadyRegistered(error: { message?: string; code?: string }) {
  return (
    error.code === "email_exists" ||
    /already been registered|already exists/i.test(error.message ?? "")
  );
}
