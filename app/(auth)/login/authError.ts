import type { AuthError } from "@supabase/supabase-js";

/**
 * PARKED. Nothing calls this while unverified sign-in is switched on (see
 * app/api/auth/dev-signin/route.ts) — it is kept ready for the day
 * `signInWithOtp` comes back, because these messages are the difference
 * between a debuggable sign-in screen and "an error occurred".
 *
 * Turns a Supabase auth failure into something that names the actual problem
 * and the next move, per §7.
 *
 * The previous version replaced every failure with one fixed sentence, which
 * meant a misconfigured redirect allow-list and an exhausted mail quota were
 * indistinguishable — and neither was debuggable from the screen.
 */
export function describeAuthFailure(
  error: AuthError,
  context: { origin: string },
): string {
  const message = error.message ?? "";
  const status = error.status ?? 0;

  // Built-in SMTP is throttled to a handful of emails an hour. This is by far
  // the most common failure while testing.
  if (status === 429 || /rate limit|too many requests/i.test(message)) {
    return "Too many sign-in emails from this project just now. Wait a few minutes, or set up custom SMTP so this stops happening.";
  }

  // emailRedirectTo is validated against the Redirect URLs allow-list, which
  // is a different setting from Site URL.
  if (/redirect|not allowed|invalid.*url|requested path/i.test(message)) {
    return `Supabase rejected this app's redirect URL. Add ${context.origin}/** to Authentication → URL Configuration → Redirect URLs. (${message})`;
  }

  if (/smtp|mail|sending/i.test(message)) {
    return `The email couldn't be sent: ${message}`;
  }

  if (/signups? not allowed|disabled/i.test(message)) {
    return `Sign-ups are turned off for this project, so a new address can't be used. (${message})`;
  }

  if (/invalid|malformed/i.test(message) && /email/i.test(message)) {
    return "That email address doesn't look right. Check it and try again.";
  }

  if (/token|otp|expired/i.test(message)) {
    return `That code didn't work: ${message}`;
  }

  // Anything unrecognised: show it rather than hide it.
  return message
    ? `Couldn't sign in: ${message}`
    : "Couldn't reach the sign-in service. Check your connection and try again.";
}
