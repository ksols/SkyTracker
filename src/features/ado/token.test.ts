import { describe, expect, it, vi } from "vitest";
import { adoAuthFor, AdoLoginRequired, tokenEndpoint, type TokenDeps } from "./token";

const ENV = { AUTH_MICROSOFT_ENTRA_ID_ID: "cid", AUTH_MICROSOFT_ENTRA_ID_SECRET: "sec", AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/t1/v2.0" };
const row = (over: Partial<{ access_token: string | null; refresh_token: string | null; expires_at: number | null }> = {}) =>
  ({ id: "acc1", access_token: "old", refresh_token: "r1", expires_at: 2000, ...over });
function deps(r: ReturnType<typeof row> | null, env: Record<string, string | undefined> = ENV, tokenResponse: { ok: boolean; body: unknown } = { ok: true, body: { access_token: "new", refresh_token: "r2", expires_in: 3600 } }) {
  const update = vi.fn().mockResolvedValue({});
  const findFirst = vi.fn().mockResolvedValue(r);
  const fetchMock = vi.fn().mockResolvedValue({ ok: tokenResponse.ok, status: tokenResponse.ok ? 200 : 400, json: async () => tokenResponse.body });
  const d: TokenDeps = { db: { account: { findFirst, update } }, fetch: fetchMock as unknown as typeof fetch, env, now: () => 1000 * 1000 };
  return { d, update, findFirst, fetchMock };
}
const session = { user: { id: "u1" } };

describe("adoAuthFor", () => {
  it("ADO_DEV_TOKEN overrides everything and never touches the database", async () => {
    const { d, findFirst } = deps(null, { ...ENV, ADO_DEV_TOKEN: "dev" });
    expect(await adoAuthFor(session, d)).toBe("Bearer dev");
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("hands out the stored token while more than two minutes remain", async () => {
    const { d, fetchMock } = deps(row({ expires_at: 2000 }));
    expect(await adoAuthFor(session, d)).toBe("Bearer old");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refreshes against the tenant's v2 token endpoint when fewer than two minutes remain and writes the new pair back", async () => {
    const { d, fetchMock, update } = deps(row({ expires_at: 1050 }));
    expect(await adoAuthFor(session, d)).toBe("Bearer new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/t1/oauth2/v2.0/token");
    const body = String(init.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=r1");
    expect(body).toContain("499b84ac-1321-427f-aa17-267ca6975798%2Fuser_impersonation");
    expect(update).toHaveBeenCalledWith({ where: { id: "acc1" }, data: { access_token: "new", refresh_token: "r2", expires_at: 1000 + 3600 } });
  });
  it("asks for a new sign-in when there is no account row, no session user, no refresh token, or the refresh is rejected", async () => {
    await expect(adoAuthFor(session, deps(null).d)).rejects.toBeInstanceOf(AdoLoginRequired);
    await expect(adoAuthFor({ user: {} }, deps(row()).d)).rejects.toBeInstanceOf(AdoLoginRequired);
    await expect(adoAuthFor(session, deps(row({ expires_at: 1050, refresh_token: null })).d)).rejects.toBeInstanceOf(AdoLoginRequired);
    await expect(adoAuthFor(session, deps(row({ expires_at: 1050 }), ENV, { ok: false, body: { error: "invalid_grant" } }).d)).rejects.toBeInstanceOf(AdoLoginRequired);
  });
  it("tokenEndpoint turns the issuer into the v2 token endpoint", () => {
    expect(tokenEndpoint("https://login.microsoftonline.com/t1/v2.0")).toBe("https://login.microsoftonline.com/t1/oauth2/v2.0/token");
    expect(tokenEndpoint("https://login.microsoftonline.com/t1/v2.0/")).toBe("https://login.microsoftonline.com/t1/oauth2/v2.0/token");
  });
});
