// The one place the ADO routes turn a failure into an answer the page understands:
// 401 ado-login (sign in again) · 502 ado (ADO said no) · anything else is rethrown.
import { AdoRequestError } from "./client";
import { AdoLoginRequired } from "./token";

export const ADO_LOGIN_MESSAGE = "Logg inn på nytt for å koble til ADO.";
export const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export function adoErrorResponse(e: unknown, extra: Record<string, unknown> = {}): Response {
  if (e instanceof AdoLoginRequired || (e instanceof AdoRequestError && e.status === 401))
    return Response.json({ error: "ado-login", message: ADO_LOGIN_MESSAGE, ...extra }, { status: 401, ...NO_STORE });
  if (e instanceof AdoRequestError)
    return Response.json({ error: "ado", message: "ADO svarte " + e.status + ". " + e.message.slice(0, 200), ...extra }, { status: 502, ...NO_STORE });
  throw e;
}
