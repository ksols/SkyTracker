// Azure DevOps connection config. Server-only — reads SKYTRACKER_ADO_PAT.
export const ADO_ORG_URL = "https://dev.azure.com/SkytaleAS";
export const ADO_PROJECT = "Skytale";
export const ADO_API_VERSION = "7.1";

/** Work item type created for every SkyTracker card (v1). */
export const ADO_WORK_ITEM_TYPE = "User Story";

/** "Blocked by" maps to a Predecessor link in ADO. */
export const ADO_PREDECESSOR_REL = "System.LinkTypes.Dependency-Reverse";

export const adoProjectUrl = () => `${ADO_ORG_URL}/${ADO_PROJECT}`;

/** Browser-facing URL for a work item (used by the card badge). */
export const adoWorkItemEditUrl = (id: number) =>
  `${ADO_ORG_URL}/${ADO_PROJECT}/_workitems/edit/${id}`;

/** REST resource URL for a work item (used as a link relation target). */
export const adoWorkItemApiUrl = (id: number) =>
  `${ADO_ORG_URL}/_apis/wit/workItems/${id}`;

export function adoPat(): string {
  const pat = process.env.SKYTRACKER_ADO_PAT;
  if (!pat) throw new Error("SKYTRACKER_ADO_PAT is not set");
  return pat;
}

export function adoAuthHeader(): string {
  return `Basic ${Buffer.from(`:${adoPat()}`).toString("base64")}`;
}
