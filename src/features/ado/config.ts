// Azure DevOps connection constants. Edge-safe (no env, no Node APIs); the token lives in token.ts.
export const ADO_ORG_URL = "https://dev.azure.com/SkytaleAS";
export const ADO_PROJECT = "Skytale";
export const ADO_API_VERSION = "7.1";
export const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
export const ADO_SCOPE = `${ADO_RESOURCE}/user_impersonation`;
/** Skytale.Specs: `spec/<Feature>/spec.md` + `estimate.yaml` (decision 3). */
export const SPECS_REPO_ID = "971ee73e-e3aa-45eb-b23b-359d1cc178e7";

/** Work item type created for every SkyTracker card (the board's flow) and for the discovery story. */
export const ADO_WORK_ITEM_TYPE = "User Story";

/** "Blocked by" maps to a Predecessor link in ADO. */
export const ADO_PREDECESSOR_REL = "System.LinkTypes.Dependency-Reverse";
export const ADO_PARENT_REL = "System.LinkTypes.Hierarchy-Reverse";
export const ADO_CHILD_REL = "System.LinkTypes.Hierarchy-Forward";

export const adoProjectUrl = () => `${ADO_ORG_URL}/${ADO_PROJECT}`;

/** Browser-facing URL for a work item (used by the card badge). */
export const adoWorkItemEditUrl = (id: number) =>
  `${ADO_ORG_URL}/${ADO_PROJECT}/_workitems/edit/${id}`;

/** REST resource URL for a work item (used as a link relation target). */
export const adoWorkItemApiUrl = (id: number) =>
  `${ADO_ORG_URL}/_apis/wit/workItems/${id}`;

/** SKYTRACKER_ADO_PEOPLE="THM=thm@skytale.no;KSO=kso@skytale.no" → upper-case initials → e-mail. */
export function peopleMap(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (env.SKYTRACKER_ADO_PEOPLE ?? "").split(/[;,]/)) {
    const [k, v] = part.split("=");
    if (k && v && v.includes("@")) out[k.trim().toUpperCase()] = v.trim();
  }
  return out;
}
