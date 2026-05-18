import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Edge-safe config: providers + pages only. NO database adapter, NO Prisma.
// Imported by both `src/lib/auth.ts` (full Node runtime) and `src/middleware.ts` (Edge runtime).
export default {
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  pages: { signIn: "/login" },
} satisfies NextAuthConfig;
