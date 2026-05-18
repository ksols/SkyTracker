import NextAuth from "next-auth";
import authConfig from "@/lib/auth.config";

// Middleware runs in Edge runtime → cannot import Prisma.
// Uses the Edge-safe `auth.config.ts` (providers only) to check session cookie.
// Actual DB session lookup happens later in server components/actions via `auth()`.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon|icon|.*\\.svg).*)"],
};
