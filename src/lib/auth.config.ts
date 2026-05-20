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
    jwt({ token, profile, account }) {
      if (profile) {
        // Decode raw ID token to get all claims including groups
        let idTokenClaims: Record<string, unknown> = {};
        if (account?.id_token) {
          try {
            const payload = account.id_token.split(".")[1];
            idTokenClaims = JSON.parse(Buffer.from(payload, "base64url").toString());
          } catch {}
        }
        console.log("[AUTH] profile keys:", Object.keys(profile));
        console.log("[AUTH] id_token claims keys:", Object.keys(idTokenClaims));
        console.log("[AUTH] id_token groups:", idTokenClaims.groups);
        console.log("[AUTH] id_token _claim_names:", idTokenClaims._claim_names);

        const groups = idTokenClaims.groups ?? (profile as Record<string, unknown>).groups;
        const groupIds = Array.isArray(groups) ? (groups as string[]) : [];
        const writersGroupId = process.env.SKYTRACKER_WRITERS_GROUP_ID;
        console.log("[AUTH] groupIds:", groupIds, "writersGroupId:", writersGroupId);
        token.role = writersGroupId && groupIds.includes(writersGroupId) ? "writer" : "reader";
        console.log("[AUTH] assigned role:", token.role);
      }
      return token;
    },
    session({ session, token }) {
      session.role = token.role ?? "reader";
      return session;
    },
  },
} satisfies NextAuthConfig;
