# Agent Preferences LAB

Tier: Demo.
Repo: https://github.com/curtismu7/agent-preferences-lab-LAB

The user sets what their AI agent is allowed to do; a mock tool boundary enforces it. This is the standalone mock of the AI-DEMO2 `agentPreferences` feature (PR #3401, enforced live on that stack 2026-11-06) — same decision contract, no real tenant.

1. **The preference.** The user (here: the visitor) sets allowed action tiers (read / write), an optional per-action spend cap, and what happens when Protect detects an AI agent: allow, human approval (HITL), or deny.
2. **The mock Protect signal.** Once per session a mock Protect evaluation runs; bot detection names the agent type (rules 660-674, e.g. "AI agent - Muse detected"). The result flags the session for every later agent call. Whether every call needs its own evaluation is an open question — once per session shipped first.
3. **The gate.** Every agent tool call is measured: tier not allowed, amount over cap, or detection against the unknown-agent policy → human approval (HTTP 428 + task id) or deny (403). An approved challenge is a single-use receipt: the retried call passes once.

Mock only. Every host ends in `.example`, and the app makes no outbound network request (a netguard blocks them and tests prove it). It needs no tenant and no credentials. Decision reasons are shown raw, so a visitor sees exactly which preference decided.

**Status: built.** Tabs: Preference gate (scenario walkthrough, live preference editor, mock Protect panel, tool-call panel, HITL approval panel), Diagram (ReactFlow from `/api/diagram`: movable boxes, Simulate, speed, Reset), Talk track. Presenter mode (`P`, `Esc` leaves) keeps the simulation banner.

## Run

```
./scripts/run.sh          # installs, builds, runs the doctor, starts; open http://localhost:7660/
```

or `npm ci && npm run doctor && npm start`. With Docker (OrbStack): `HOST_PORT=7660 docker compose up --build -d` (published on `127.0.0.1` only).

| Command | What it does |
| --- | --- |
| `npm test` | server (node:test), web (vitest) and repo checks |
| `npm run doctor` | preflight: node, mode, bind, port, scenarios, labels, tokens, hosts, keys, diagrams, netguard, port free |
| `npm run content-pack` | rebuilds and validates `content-pack.json` |
| `npm run reset` | resets the default workspace's preferences, detection, challenges and runs on a running server |

Port range 7660-7669 (default 7660). `GET /api/health` answers `demo-health/1`.

## Run from a clone

Prerequisites: Node 26 or newer. Docker (OrbStack) only if you use the Docker form. Mock needs no tenant, credentials or settings.

```
git clone https://github.com/curtismu7/agent-preferences-lab-LAB.git
cd agent-preferences-lab-LAB
npm ci
npm run build
npm run doctor
npm start
```

Open http://127.0.0.1:7660/ (the server serves the built page). `GET /api/health` answers `demo-health/1`. Or with Docker: `HOST_PORT=7660 docker compose up --build -d` from the same folder.

## Ports, and what to do if the port is taken

```
Ports: agent-preferences-lab-LAB listens on 7660 by default (allowed range 7660-7669).
Docker publishes it on 127.0.0.1:7660 only.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:7660 -sTCP:LISTEN -n -P
2. If it is an old copy of this lab (npm start), stop that process: kill <PID>.
   If it is this lab's container: docker compose down (from this folder).
3. If it is something else, stop it and free 7660. The server refuses ports outside
   7660-7669 on purpose (npm run doctor says so).
4. Then start again: npm start, or docker compose up -d.
```

## API

- `GET /api/scenarios` — the story: title, intro, banner, tools, five scenarios, facts (measured / inferred / UNVERIFIED), talk track.
- `GET/POST /api/preferences` — read / set this workspace's agent preferences (normalized; bad values fall back to defaults).
- `POST /api/protect/evaluate` — the session-start mock Protect evaluation, body `{ ruleId: 660|661|674|null }`.
- `POST /api/mcp/tool` — the gate. Body `{ tool, params? }`. `200` permit, `428` HITL with `taskId`, `403` deny. Raw mock hops with W3C `traceparent`.
- `GET /api/challenges`, `POST /api/challenges/:id/respond` — the HITL approval panel. Approval = single-use receipt.
- `GET /api/runs`, `POST /api/reset` — per-workspace history and reset.
- `GET /api/diagram`, `GET /api/info`, `GET /api/health` — diagram-studio/1 data, build info, `demo-health/1`.

Workspace id goes in `X-Workspace` (one visitor's state never touches another's).

## What is real, and what is not

- Real (shape and contract): the preference schema, the permit / HITL / deny decisions, the 428 + taskId approval flow, the single-use receipt, the fail-closed default. All enforced in AI-DEMO2 on 2026-11-06 (source: this repo's README and PR #3401).
- Mock: Protect (no Signals SDK, no tenant — the rule picker stands in for real detection), the PingOne attribute (preferences live in the workspace, not a directory), the tools.
- UNVERIFIED / open: whether Protect should evaluate per tool call rather than once per session; the exact Protect rule ids beyond what AI-DEMO2 observed.

## Attribution

Forked from the `gateway-claims-lab` scaffold (gateway-claims-lab-node26 working copy); server, web, scripts and safety infrastructure are that scaffold's, rebranded. The domain content (preferences, Protect signal, gate, HITL) is new, derived from AI-DEMO2 PR #3401. No code was imported across repos.
