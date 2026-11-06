import { workspaceFetch } from "./workspace";

export async function getJson(url) {
  const r = await workspaceFetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// POST /api/preferences: set this workspace's agent preferences (the user IS the visitor here).
export async function setPreferences(payload) {
  const r = await workspaceFetch("/api/preferences", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

export const getPreferences = () => getJson("/api/preferences");

// POST /api/mode: the rule 19 Mock/Real toggle. 409 when Real is not configured.
export async function setMode(source) {
  const r = await workspaceFetch("/api/mode", { method: "POST", body: JSON.stringify({ source }) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// POST /api/protect/evaluate: the session-start mock Protect evaluation.
export async function evaluateProtect(payload) {
  const r = await workspaceFetch("/api/protect/evaluate", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// POST /api/mcp/tool: one agent tool call through the gate. 428/403 are DATA here, not errors.
export async function runTool(payload) {
  const r = await workspaceFetch("/api/mcp/tool", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

export const listChallenges = () => getJson("/api/challenges");

export async function respondChallenge(id, payload) {
  const r = await workspaceFetch(`/api/challenges/${encodeURIComponent(String(id))}/respond`, { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

export const resetWorkspace = () => workspaceFetch("/api/reset", { method: "POST", body: "{}" }).then((r) => r.ok);
