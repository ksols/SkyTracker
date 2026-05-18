import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import authConfig from "@/lib/auth.config";

// Full Node-runtime config: adds the Prisma adapter to the Edge-safe base config.
// Do NOT import this from middleware (Edge runtime); use `auth.config.ts` there.
// Session strategy is set in auth.config.ts (must be JWT for Edge compatibility).
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
});
