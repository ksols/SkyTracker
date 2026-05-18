import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import authConfig from "@/lib/auth.config";

// Full Node-runtime config: includes the Prisma adapter + DB session strategy.
// Do NOT import this from middleware (Edge runtime); use `auth.config.ts` there.
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
});
