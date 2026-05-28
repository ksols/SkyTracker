import {
  ADO_API_VERSION,
  ADO_PREDECESSOR_REL,
  ADO_PROJECT,
  ADO_WORK_ITEM_TYPE,
  adoAuthHeader,
  adoProjectUrl,
  adoWorkItemApiUrl,
} from "./config";
import { buildWorkItemPatch, matchIterationName } from "./mappers";

async function adoFetch(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: adoAuthHeader(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ADO request failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

export async function createWorkItem(input: {
  title: string;
  description: string;
  tags: string[];
  iterationPath: string | null;
}): Promise<number> {
  const patch = buildWorkItemPatch(input);
  const url = `${adoProjectUrl()}/_apis/wit/workitems/$${encodeURIComponent(
    ADO_WORK_ITEM_TYPE,
  )}?api-version=${ADO_API_VERSION}`;
  const res = await adoFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(patch),
  });
  const body = (await res.json()) as { id: number };
  return body.id;
}

export async function resolveIterationPath(sprintNumber: number): Promise<string | null> {
  const url = `${adoProjectUrl()}/_apis/wit/classificationnodes/iterations?$depth=2&api-version=${ADO_API_VERSION}`;
  const res = await adoFetch(url, { method: "GET" });
  const root = (await res.json()) as { children?: { name: string }[] };
  const names = (root.children ?? []).map((c) => c.name);
  const match = matchIterationName(names, sprintNumber);
  return match ? `${ADO_PROJECT}\\${match}` : null;
}

export async function addPredecessorLink(
  blockedWorkItemId: number,
  blockerWorkItemId: number,
): Promise<void> {
  const url = `${adoProjectUrl()}/_apis/wit/workitems/${blockedWorkItemId}?api-version=${ADO_API_VERSION}`;
  const patch = [
    {
      op: "add",
      path: "/relations/-",
      value: { rel: ADO_PREDECESSOR_REL, url: adoWorkItemApiUrl(blockerWorkItemId) },
    },
  ];
  await adoFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(patch),
  });
}
