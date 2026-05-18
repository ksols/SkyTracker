import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Edge-safe config: providers + pages + session strategy. NO database adapter, NO Prisma.
// Imported by both `src/lib/auth.ts` (full Node runtime) and `src/middleware.ts` (Edge runtime).
// JWT strategy is required when middleware runs in Edge — database sessions can't be validated
// without a DB roundtrip, and Edge can't reach Prisma.
export default {
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
} satisfies NextAuthConfig;
