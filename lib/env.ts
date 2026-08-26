/**
 * Env access that fails loudly at the call site instead of producing
 * `undefined` deep inside a Supabase or Groq client.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/** Safe in the browser — both values are public by design. */
export const publicEnv = {
  supabaseUrl: () =>
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () =>
    required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
};

/** Server only. Importing this from a client component is a build error. */
export const serverEnv = {
  serviceRoleKey: () =>
    required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
  groqApiKey: () => required("GROQ_API_KEY", process.env.GROQ_API_KEY),
  resendApiKey: () => required("RESEND_API_KEY", process.env.RESEND_API_KEY),
  emailFrom: () => required("EMAIL_FROM", process.env.EMAIL_FROM),
  appUrl: () => process.env.APP_URL ?? "http://localhost:3000",
  workerSecret: () => required("WORKER_SECRET", process.env.WORKER_SECRET),
};
