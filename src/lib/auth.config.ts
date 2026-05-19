import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Edge-safe config: providers + pages + session strategy + callbacks.
// NO database adapter, NO Prisma.
// Imported by both `src/lib/auth.ts` (full Node runtime) and `src/middleware.ts` (Edge runtime).
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
  callbacks: {
    jwt({ token, profile }) {
      if (profile) {
        const groups = (profile as Record<string, unknown>).groups;
        const groupIds = Array.isArray(groups) ? (groups as string[]) : [];
        const writersGroupId = process.env.SKYTRACKER_WRITERS_GROUP_ID;
        token.role = writersGroupId && groupIds.includes(writersGroupId) ? "writer" : "reader";
      }
      return token;
    },
    session({ session, token }) {
      session.role = token.role ?? "reader";
      return session;
    },
  },
} satisfies NextAuthConfig;
