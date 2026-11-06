# agent-preferences-lab

Demo-tier standalone app: the user sets what their AI agent may do (allowed action tiers, spend cap, unknown-agent policy); a mock tool boundary enforces it on every agent tool call — permit, human approval (HITL, 428 + taskId, single-use receipt) or deny (403). A mock Protect evaluation at session start names an AI agent (rules 660-674) and feeds the unknown-agent policy. Standalone mock of the AI-DEMO2 `agentPreferences` feature (PR #3401, enforced live 2026-11-06).

- Run: `./scripts/run.sh` (http://localhost:7660). Test: `npm test` (server is `node --test test/*.test.js`, a glob). Preflight: `npm run doctor`. Reset: `npm run reset`.
- Core: `server/src/preferences.js` (pure `normalizePreferences`, `evaluatePreferences`, `evaluateProtectSignals`, `getRequiredTier`, challenge store). Story data `server/src/preferencesData.js` with `{{castBrand}}`-style tokens filled by `cast.js` (3 vertical packs); a test fails on an undefined token. Diagram: `server/diagrams/preferences-flow.json` (diagram-studio/1).
- API: `GET/POST /api/preferences`, `POST /api/protect/evaluate`, `POST /api/mcp/tool` (200/428/403), `GET /api/challenges`, `POST /api/challenges/:id/respond`, `GET /api/runs`, `POST /api/reset`, `GET /api/info`, `GET /api/health` (demo-health/1). Workspace id in `X-Workspace`.
- Rules that bite: loopback bind only; same-origin writes; zero outbound network (netguard); only `.example`/`.invalid` hosts; no `crypto.generateKeyPairSync('ec')`; ports 7660-7669; tokens and detection values are mock and shown raw; per-call Protect evaluation is an OPEN question (labelled inferred) — do not present it as decided.
- Web: `web/src/App.jsx` (tabs, presenter, Reset, X-Workspace via `workspace.js`), `components/PreferencesGate` (editor, Protect panel, tool call, approval panel), `DiagramTab` + `PatternDiagram` (from the scaffold). Colours come from `tokens.css` only. Test: `npm test -w web` (vitest + RTL, mocked fetch).
- Trace: `server/src/trace.js` builds W3C traceparent for every mock hop in `/api/mcp/tool` and `/api/protect/evaluate`.
- Attribution: forked from the gateway-claims-lab scaffold; see README. No cross-repo imports.
