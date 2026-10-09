import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import authConfig from "@/lib/auth.config";
import { ENTRA_PROVIDER, storeSignInTokens } from "@/features/ado/token";

// Full Node-runtime config: the Prisma adapter, plus the two things the Edge config cannot do:
// keep the person's ADO tokens on the Account row at every sign-in (spec §3 «ADO access» 2) and
// expose the user id on the session so the ADO routes can find that row.
// Do NOT import this from middleware (Edge runtime); use `auth.config.ts` there.
// Session strategy is set in auth.config.ts (must be JWT for Edge compatibility).
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = authConfig.callbacks.jwt(params);
      if (params.account?.provider === ENTRA_PROVIDER) await storeSignInTokens(prisma, params.account).catch(() => {});
      return token;
    },
    session(params) {
      const session = authConfig.callbacks.session(params);
      if (session.user && params.token.sub) session.user.id = params.token.sub;
      return session;
    },
  },
});
