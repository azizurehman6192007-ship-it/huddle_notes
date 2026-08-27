import "server-only";

import { Resend } from "resend";
import { serverEnv } from "@/lib/env";
import type { EmailContent } from "@/lib/email/templates";

let client: Resend | null = null;

function resend(): Resend {
  client ??= new Resend(serverEnv.resendApiKey());
  return client;
}

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailError";
  }
}

export interface Attachment {
  filename: string;
  content: Uint8Array;
}

export interface SendResult {
  email: string;
  providerId: string | null;
  status: "queued" | "failed";
  error?: string;
}

/**
 * One send per recipient, on purpose: §10 wants an email_log row each, and
 * nobody on a standup list should see everyone else's address in a To: header.
 * One bad address must not take the rest of the team down with it, so each
 * result is reported independently.
 */
/* ------------------------------------------------------------------------ *
 *  ████  TEMP DEMO HACK — remove once a verified domain is set up  ████      *
 * ------------------------------------------------------------------------ *
 *                                                                           *
 *  EVERY OUTGOING EMAIL IS REDIRECTED TO ONE ADDRESS.                       *
 *                                                                           *
 *  The project is still on Resend's sandbox sender (onboarding@resend.dev), *
 *  which only delivers to the address the Resend account is registered      *
 *  under. Sending to anyone else comes back 403 and the demo dies on the    *
 *  last click. So the recipient is overridden here, at the very edge, just  *
 *  before the provider call.                                               *
 *                                                                           *
 *  Deliberately scoped so nothing else can tell:                            *
 *    - the UI still picks and confirms the real recipients                  *
 *    - SendResult still reports the INTENDED address, so email_log rows,    *
 *      sent_count and the confirm sheet stay truthful                       *
 *    - the message body never mentions the override                         *
 *                                                                           *
 *  TO REMOVE: delete this block and the two lines marked TEMP DEMO HACK     *
 *  inside sendNotes. Nothing else refers to it.                             *
 *                                                                           *
 *  Real fix: verify a domain at resend.com/domains, then set EMAIL_FROM to  *
 *  an address on it. Then this override must go — with a verified domain    *
 *  it would silently stop the whole team receiving their notes.             *
 * ------------------------------------------------------------------------ */
const TEMP_DEMO_FORCE_RECIPIENT = "tiyic0832@gmail.com";

export async function sendNotes(input: {
  to: string[];
  content: EmailContent;
  attachment: Attachment;
}): Promise<SendResult[]> {
  const from = serverEnv.emailFrom();
  const attachments = [
    {
      filename: input.attachment.filename,
      content: Buffer.from(input.attachment.content).toString("base64"),
    },
  ];

  const results: SendResult[] = [];

  for (const email of input.to) {
    // TEMP DEMO HACK — remove once a verified domain is set up.
    const deliverTo = TEMP_DEMO_FORCE_RECIPIENT || email;
    if (deliverTo !== email) {
      console.warn(
        `[email] TEMP DEMO HACK: redirecting notes for ${email} to ${deliverTo}. Remove this before real use.`,
      );
    }

    try {
      const { data, error } = await resend().emails.send({
        from,
        to: [deliverTo],
        subject: input.content.subject,
        html: input.content.html,
        text: input.content.text,
        attachments,
      });

      if (error) {
        results.push({
          email,
          providerId: null,
          status: "failed",
          error: error.message,
        });
        continue;
      }

      results.push({ email, providerId: data?.id ?? null, status: "queued" });
    } catch (caught) {
      results.push({
        email,
        providerId: null,
        status: "failed",
        error: caught instanceof Error ? caught.message : "send failed",
      });
    }
  }

  return results;
}

export interface EmailConfigStatus {
  /** Both variables present. Send is enabled only when this is true. */
  configured: boolean;
  /**
   * Human-readable problems, NAMES ONLY — never values. Rendered on the notes
   * screen, so a secret must never end up in here.
   */
  problems: string[];
}

/**
 * Why this reports detail rather than a bare boolean: the old message named
 * both variables whatever was actually wrong, so a deployment with one of them
 * missing (or set on the wrong Vercel environment) looked identical to one
 * with neither, and there was no way to tell from the running site.
 *
 * Note there is no format requirement on EMAIL_FROM. Resend accepts both
 * `notes@example.com` and `Huddle <notes@example.com>`; anything non-empty
 * enables Send, and the provider has the final say.
 *
 * Read at request time — the pages that call it are `force-dynamic`, so this
 * reflects the running environment, not the build.
 */
export function emailConfigStatus(): EmailConfigStatus {
  const key = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.EMAIL_FROM?.trim() ?? "";

  const problems: string[] = [];

  if (!key) problems.push("RESEND_API_KEY isn't set");
  else if (!key.startsWith("re_")) {
    // A warning, not a blocker — the provider decides what is valid.
    problems.push("RESEND_API_KEY doesn't start with re_, so it may be wrong");
  }

  if (!from) problems.push("EMAIL_FROM isn't set");
  else if (!from.includes("@")) {
    problems.push("EMAIL_FROM has no @ in it, so it isn't an address");
  }

  return { configured: Boolean(key && from), problems };
}

/** True when email is configured at all — the UI hides Send otherwise. */
export function isEmailConfigured(): boolean {
  return emailConfigStatus().configured;
}
