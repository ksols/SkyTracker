// The signed-in person's Azure DevOps token (spec §3 «ADO access»): read from the Auth.js Account row,
// refreshed against Entra when fewer than two minutes remain, never sent to the browser. ADO_DEV_TOKEN
// (local only) overrides it. No PAT anywhere.
import type { PrismaClient } from "@/generated/prisma/client";
import { ADO_SCOPE } from "./config";

export class AdoLoginRequired extends Error {
  constructor(message = "ado-login") {
    super(message);
    this.name = "AdoLoginRequired";
  }
}
export const ENTRA_PROVIDER = "microsoft-entra-id";
const REFRESH_MARGIN_S = 120;

export type TokenRow = { id: string; access_token: string | null; refresh_token: string | null; expires_at: number | null };
export type TokenDeps = {
  db: {
    account: {
      findFirst(args: { where: { userId: string; provider: string } }): Promise<TokenRow | null>;
      update(args: { where: { id: string }; data: { access_token: string; refresh_token: string | null; expires_at: number } }): Promise<unknown>;
    };
  };
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => number; // ms since epoch
};

export function tokenEndpoint(issuer: string): string {
  return issuer.replace(/\/v2\.0\/?$/, "") + "/oauth2/v2.0/token";
}

export async function adoAuthFor(session: { user?: { id?: string | null } | null } | null, deps: TokenDeps): Promise<string> {
  const dev = deps.env.ADO_DEV_TOKEN?.trim();
  if (dev) return "Bearer " + dev;
  const userId = session?.user?.id;
  if (!userId) throw new AdoLoginRequired();
  const row = await deps.db.account.findFirst({ where: { userId, provider: ENTRA_PROVIDER } });
  if (!row?.access_token) throw new AdoLoginRequired();
  const nowS = Math.floor(deps.now() / 1000);
  if (row.expires_at && row.expires_at - nowS > REFRESH_MARGIN_S) return "Bearer " + row.access_token;
  if (!row.refresh_token) throw new AdoLoginRequired();
  const { AUTH_MICROSOFT_ENTRA_ID_ID: id, AUTH_MICROSOFT_ENTRA_ID_SECRET: secret, AUTH_MICROSOFT_ENTRA_ID_ISSUER: issuer } = deps.env;
  if (!id || !secret || !issuer) throw new AdoLoginRequired("entra-config");
  const res = await deps.fetch(tokenEndpoint(issuer), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
      scope: ADO_SCOPE + " offline_access openid profile email",
    }).toString(),
  });
  if (!res.ok) throw new AdoLoginRequired();
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!j.access_token) throw new AdoLoginRequired();
  const expires_at = nowS + (j.expires_in ?? 3600);
  await deps.db.account.update({ where: { id: row.id }, data: { access_token: j.access_token, refresh_token: j.refresh_token ?? row.refresh_token, expires_at } });
  return "Bearer " + j.access_token;
}

/** Called from the Node jwt callback on every sign-in: the adapter writes the tokens only when it first links the account. */
export async function storeSignInTokens(
  db: PrismaClient,
  account: { provider: string; providerAccountId: string; access_token?: string; refresh_token?: string; expires_at?: number; scope?: string },
): Promise<void> {
  if (!account.access_token) return;
  await db.account.updateMany({
    where: { provider: account.provider, providerAccountId: account.providerAccountId },
    data: { access_token: account.access_token, refresh_token: account.refresh_token ?? undefined, expires_at: account.expires_at ?? null, scope: account.scope ?? null },
  });
}

export const defaultTokenDeps = (db: PrismaClient): TokenDeps => ({
  db: db as unknown as TokenDeps["db"],
  fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
  env: process.env,
  now: () => Date.now(),
});
