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
    try {
      const { data, error } = await resend().emails.send({
        from,
        to: [email],
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

/** True when email is configured at all — the UI hides Send otherwise. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
