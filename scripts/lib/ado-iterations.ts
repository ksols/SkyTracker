const ORG = "https://dev.azure.com/SkytaleAS";
const PROJECT = "Skytale";
const TEAM = "Dev Team";
const API = "7.1";

import { execSync } from "node:child_process";

// No PAT anywhere: the admin script runs as the person at the keyboard, through `az login`
// (the same token the app's ADO_DEV_TOKEN override takes), like Skytale.QA's scripts.
const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
let cachedAuth: string | null = null;
function authHeader(): string {
  if (cachedAuth) return cachedAuth;
  const fromEnv = process.env.ADO_DEV_TOKEN?.trim();
  const token = fromEnv || execSync(`az account get-access-token --resource ${ADO_RESOURCE} --query accessToken -o tsv`, { stdio: "pipe" }).toString().trim();
  if (!token) throw new Error("No ADO token: run `az login` (or set ADO_DEV_TOKEN)");
  cachedAuth = `Bearer ${token}`;
  return cachedAuth;
}

async function adoFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ADO ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export type ExistingIteration = { name: string; startDate?: string; finishDate?: string };

/** All "Sprint N" iteration nodes (direct children of the project root). */
export async function listSprintIterations(): Promise<ExistingIteration[]> {
  const url = `${ORG}/${PROJECT}/_apis/wit/classificationnodes/iterations?$depth=2&api-version=${API}`;
  const root = (await adoFetch(url)) as {
    children?: { name: string; attributes?: { startDate?: string; finishDate?: string } }[];
  };
  return (root.children ?? [])
    .filter((c) => /^Sprint \d+/.test(c.name))
    .map((c) => ({ name: c.name, startDate: c.attributes?.startDate, finishDate: c.attributes?.finishDate }));
}

/** Create the iteration classification node; returns its GUID identifier. */
export async function createIterationNode(name: string, start: Date, finish: Date): Promise<string> {
  const url = `${ORG}/${PROJECT}/_apis/wit/classificationnodes/iterations?api-version=${API}`;
  const body = {
    name,
    attributes: { startDate: start.toISOString(), finishDate: finish.toISOString() },
  };
  const node = (await adoFetch(url, { method: "POST", body: JSON.stringify(body) })) as {
    identifier: string;
  };
  return node.identifier;
}

/** Register a created iteration node (by GUID) as a Dev Team backlog iteration. */
export async function registerTeamIteration(identifier: string): Promise<void> {
  const url = `${ORG}/${PROJECT}/${encodeURIComponent(TEAM)}/_apis/work/teamsettings/iterations?api-version=${API}`;
  await adoFetch(url, { method: "POST", body: JSON.stringify({ id: identifier }) });
}
