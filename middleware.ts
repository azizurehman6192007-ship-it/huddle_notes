import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

const PUBLIC_PATHS = [
  "/login",
  // Sign-in and sign-out must be reachable with no session — the sign-in
  // route is what creates one.
  "/api/auth",
];

/**
 * Refreshes the Supabase session cookie on every request and keeps signed-out
 * users out of the app shell. Route handlers do their own authorisation.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.supabaseUrl(),
    publicEnv.supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser(), not getSession() — this revalidates the token with Supabase.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Carry the query along inside `next`, not beside it. A link from an
    // email can carry its target in the query string, and cloning would
    // otherwise leave those params stranded on /login while `next` pointed
    // at the bare path.
    const target = `${pathname}${request.nextUrl.search}`;
    url.search = "";
    url.searchParams.set("next", target);
    return NextResponse.redirect(url);
  }

  // /login is deliberately NOT redirected away from when a session exists.
  // It used to be, which meant a signed-in user could never reach the form to
  // switch address — so every email they typed appeared to open the same
  // dashboard. The page offers "continue" and "sign out" instead.

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, the worker, and inbound webhooks. Those
    // last two authenticate with a shared secret rather than a session cookie,
    // and redirecting them to /login would silently swallow every delivery.
    "/((?!_next/static|_next/image|favicon.ico|api/worker|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
