// The story as data: the user's agent preferences, a mock tool boundary that enforces them, and the session-start
// mock Protect AI-agent detection signal. Mirrors the AI-DEMO2 agentPreferences contract (PR #3401) in mock.
// Text is {{token}} templated (see cast.js). Every host ends in .example. No real credential, tenant or customer.

export const BANNER = 'SIMULATED: mock user preferences, a mock Protect agent-detection signal and a mock tool boundary. Nothing here calls a real gateway, identity provider or tenant.';
export const HOSTED_BANNER = 'HOSTED SIMULATION: mock user preferences, a mock Protect agent-detection signal and a mock tool boundary. Nothing here calls a real gateway, identity provider or tenant.';

export const TITLE = "Agent preferences: what {{castBrand}}'s user lets their AI agent do";
export const INTRO = 'The user sets what their AI agent is allowed to do: which action tiers, a spend cap, and what to do when Protect detects an AI agent in the session. The mock tool boundary enforces the preference on every agent tool call: permit, human approval (HITL), or deny.';

// status: measured = seen live in AI-DEMO2 (PR #3401, enforced on the local stack 2026-11-06); inferred = our reading; UNVERIFIED = not confirmed.
export const FACTS = [
  { id: 'attribute', status: 'measured', text: 'Preferences live on the PingOne user as a JSON attribute, agentPreferences, written by an admin API and read through a 5-second cache. Shape: allowedActions, maxAmount, detectAgent, unknownAgentPolicy.', source: 'AI-DEMO2 PR #3401, enforced live on the local stack 2026-11-06' },
  { id: 'gate', status: 'measured', text: 'The gate runs on the MCP tool-call endpoint for agent-originated calls only (a verified RFC 8693 act claim). Direct user calls are never gated.', source: 'AI-DEMO2 PR #3401' },
  { id: 'hitl-contract', status: 'measured', text: 'A blocked-but-approvable action is answered HTTP 428 with a taskId; the same challenge store serves the BFF and the gateway, and approving it lets the call proceed.', source: 'AI-DEMO2 PR #3401, challenge resolved live 2026-11-06' },
  { id: 'protect-signal', status: 'measured', text: "Protect's bot detection names the agent type (rules 660-674, e.g. \"AI agent - Muse detected\") when the Signals SDK runs with agent identification on. In AI-DEMO2 it is a SESSION-START signal: flag the session once, gate every agent call in it.", source: 'AI-DEMO2 Protect browser demo + PR #3401' },
  { id: 'per-call-open', status: 'inferred', text: 'Whether every tool call needs its own Protect evaluation (instead of once per session) is an open question the owner wants tested; once per session was shipped first.', source: 'owner decision 2026-11-06' },
  { id: 'failover', status: 'measured', text: 'When the preference cannot be read (PingOne unreachable, unknown user) the gate fails CLOSED: no allowed actions, unknown-agent policy HITL — unless the deployment has failover_mode=permit.', source: 'AI-DEMO2 PR #3401' },
];

// The user's preferences, as data. A visitor edits these in the UI; the server normalizes them (preferences.js).
export const RULE = {
  name: 'User agent preferences (mock)',
  appliesTo: 'Tool boundary https://mcp.{{castHost}}.example/api/mcp/tool',
  note: 'Mock shape of the agentPreferences JSON attribute. Not exported from, or checked against, a real PingOne tenant.',
  defaults: { allowedActions: ['read', 'write'], maxAmount: null, detectAgent: true, unknownAgentPolicy: 'hitl' },
};

// Mock tools with their tiers (read = list/get, write = create/transfer/redeem), mirroring the AI-DEMO2 scope topology.
export const TOOLS = [
  { name: 'get_my_accounts', tier: 'read', sampleAmount: null, lesson: 'A read tool the agent may call when the user allows the read tier.' },
  { name: 'get_transactions', tier: 'read', sampleAmount: null, lesson: 'Another read tool; tiers come from scope topology, not a hardcoded list.' },
  { name: 'get_loyalty_status', tier: 'read', sampleAmount: null, lesson: 'Read tools are unaffected by a spend cap — the cap applies to amounts.' },
  { name: 'create_transfer', tier: 'write', sampleAmount: 750, lesson: 'A write tool with an amount: the spend cap catches it when 750 exceeds the cap.' },
  { name: 'pay_bill', tier: 'write', sampleAmount: 220, lesson: 'A small write: under most caps, so only the tier list decides.' },
  { name: 'redeem_miles', tier: 'write', sampleAmount: 1200, lesson: 'A large write: over a 500 cap, so the cap (not the tier) blocks it.' },
];

// Five preference scenarios, the walkthrough of the gate. Same idea as five tokens against a rule.
export const SCENARIOS = [
  {
    id: 'allowed-read',
    title: 'Permitted: read tool, read allowed',
    tool: 'get_my_accounts',
    preferences: { allowedActions: ['read', 'write'], detectAgent: true, unknownAgentPolicy: 'hitl' },
    detectedAgent: false,
    expected: 'permit',
    lesson: 'The tier is in the allowed list, no cap applies to reads, and nothing detected an agent: permit.',
  },
  {
    id: 'write-blocked',
    title: 'HITL: write tool, user allows read only',
    tool: 'create_transfer',
    preferences: { allowedActions: ['read'], detectAgent: true, unknownAgentPolicy: 'hitl' },
    detectedAgent: false,
    expected: 'hitl',
    lesson: 'The tool needs the write tier; the user only allowed read. The call is not lost — it becomes a human-approval task (HTTP 428).',
  },
  {
    id: 'over-cap',
    title: 'HITL: amount over the spend cap',
    tool: 'create_transfer',
    preferences: { allowedActions: ['read', 'write'], maxAmount: 500, detectAgent: true, unknownAgentPolicy: 'hitl' },
    detectedAgent: false,
    expected: 'hitl',
    lesson: 'The tier is allowed but the amount (750) exceeds the 500 cap. The cap reason is what the human sees.',
  },
  {
    id: 'protect-hitl',
    title: 'HITL: Protect detects an AI agent',
    tool: 'get_my_accounts',
    preferences: { allowedActions: ['read', 'write'], detectAgent: true, unknownAgentPolicy: 'hitl' },
    detectedAgent: true,
    expected: 'hitl',
    lesson: 'Mock Protect named an AI agent at session start and the default policy is hitl: even an allowed read goes to a human first.',
  },
  {
    id: 'protect-deny',
    title: 'Denied: Protect detection with a deny policy',
    tool: 'get_my_accounts',
    preferences: { allowedActions: ['read', 'write'], detectAgent: true, unknownAgentPolicy: 'deny' },
    detectedAgent: true,
    expected: 'deny',
    lesson: 'The user chose to deny detected agents outright: HTTP 403, no approval path. The strictest preference wins.',
  },
];

// The talk track, as data, so the web talk-track view and presenter mode read the same words as docs/talk-track.md.
export const TALK_TRACK = [
  { id: 'say-first', title: 'Say first', say: 'Everything here is simulated: the preferences, the Protect signal and the tool boundary are mock, mirroring what we enforced live in AI-DEMO2 on 2026-11-06.' },
  { id: 'preferences', title: 'The preference', say: 'The user — not the admin, not the agent — sets what their agent may do: allowed action tiers, an optional spend cap, and what happens when Protect detects an AI agent. The preference lives on the user as a JSON attribute.' },
  { id: 'boundary', title: 'The tool boundary', say: 'Every agent-originated tool call passes the gate. It checks the tier against the allowed list, the amount against the cap, and the session-start detection signal against the unknown-agent policy. Permit, human approval, or deny.' },
  { id: 'hitl', title: 'Human approval', say: 'A blocked-but-approvable call is answered 428 with a task id. The human approves or denies in the approval panel; an approved task lets the retried call proceed. Deny ends it.' },
  { id: 'protect', title: 'Protect agent detection', say: "With agent identification on, Protect's bot detection names the agent type — rules 660 to 674, like \"AI agent - Muse detected\". That is the session-start signal here. Whether every call needs its own evaluation is still open; once per session shipped first." },
  { id: 'failover', title: 'When the preference cannot be read', say: 'The gate fails closed: no allowed actions, unknown agents go to a human. An outage never silently grants an agent more freedom.' },
  { id: 'unverified', title: 'What we do not claim', say: 'The mock values are invented; only the shape and the decision contract follow what we enforced live. Whether Protect should evaluate per call is UNVERIFIED until tested.' },
  { id: 'close', title: 'Close', say: 'Reset clears your workspace: preferences, detections, challenges and runs. Nothing was sent anywhere.' },
];
