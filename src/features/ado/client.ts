// One thin REST client over fetch with the signed-in person's bearer token (token.ts). Used by the
// timeline's push/refresh/import (push.ts, import.ts). Mirrors the endpoints and api-versions of
// Skytale.QA's client.
import { ADO_API_VERSION, ADO_ORG_URL, adoProjectUrl } from "./config";

export type JsonPatch = { op: "add" | "replace" | "remove"; path: string; value?: unknown };
export type AdoRelation = { rel: string; url: string; attributes?: Record<string, unknown> };
export type AdoWorkItem = { id: number; rev?: number; fields: Record<string, unknown>; relations?: AdoRelation[] };
export type IterationNode = { id?: number; name: string; path?: string; attributes?: { startDate?: string; finishDate?: string }; children?: IterationNode[] };
export type AdoClient = {
  /** null when the work item does not exist. Relations expanded. */
  get(id: number): Promise<AdoWorkItem | null>;
  /** Up to 200 ids per request; ids that do not exist are omitted. Relations expanded. */
  batch(ids: number[]): Promise<AdoWorkItem[]>;
  create(type: string, patch: JsonPatch[]): Promise<AdoWorkItem>;
  patch(id: number, patch: JsonPatch[]): Promise<AdoWorkItem>;
  iterations(): Promise<IterationNode>;
  /** A WIQL query on the project; the ids in ADO's order (the caller batches them). */
  wiql(query: string): Promise<number[]>;
  /** A file's text from a git repository, null when the path does not exist. */
  gitItem(repoId: string, path: string): Promise<string | null>;
};
export class AdoRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "AdoRequestError";
  }
}
// A rejected or absent token gets the sign-in page: HTML, often with status 200 or 203.
const looksLikeHtml = (text: string) => /^[\s﻿]*</.test(text);

export function createAdoClient(authHeader: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): AdoClient {
  async function request<T>(method: string, url: string, body?: unknown, contentType = "application/json", nullOn404 = false): Promise<T | null> {
    const headers: Record<string, string> = { Authorization: authHeader, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = contentType;
    const res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (res.status === 404 && nullOn404) return null;
    if (looksLikeHtml(text) || res.status === 401 || res.status === 203) throw new AdoRequestError(401, "ADO rejected the token");
    if (!res.ok) throw new AdoRequestError(res.status, `ADO ${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as T) : null;
  }
  const v = "api-version=" + ADO_API_VERSION;
  return {
    get: (id) => request<AdoWorkItem>("GET", `${ADO_ORG_URL}/_apis/wit/workitems/${id}?$expand=relations&${v}`, undefined, undefined, true),
    async batch(ids) {
      const out: AdoWorkItem[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const r = await request<{ value: AdoWorkItem[] }>("POST", `${ADO_ORG_URL}/_apis/wit/workitemsbatch?${v}`, { ids: ids.slice(i, i + 200), $expand: "relations", errorPolicy: "omit" });
        out.push(...(r?.value ?? []));
      }
      return out;
    },
    create: async (type, patch) => (await request<AdoWorkItem>("POST", `${adoProjectUrl()}/_apis/wit/workitems/$${encodeURIComponent(type)}?${v}`, patch, "application/json-patch+json"))!,
    patch: async (id, patch) => (await request<AdoWorkItem>("PATCH", `${ADO_ORG_URL}/_apis/wit/workitems/${id}?${v}`, patch, "application/json-patch+json"))!,
    async wiql(query) {
      const r = await request<{ workItems?: { id: number }[] }>("POST", `${adoProjectUrl()}/_apis/wit/wiql?${v}`, { query });
      return (r?.workItems ?? []).map((w) => w.id);
    },
    iterations: async () => (await request<IterationNode>("GET", `${adoProjectUrl()}/_apis/wit/classificationnodes/iterations?$depth=2&${v}`))!,
    async gitItem(repoId, path) {
      const r = await request<{ content?: string }>("GET", `${adoProjectUrl()}/_apis/git/repositories/${repoId}/items?path=${encodeURIComponent(path)}&includeContent=true&${v}`, undefined, undefined, true);
      return r?.content ?? null;
    },
  };
}
