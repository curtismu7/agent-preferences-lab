// Pure preference engine: no I/O, no clocks. Mirrors the AI-DEMO2 agentPreferences contract (PR #3401) in mock:
// the user sets what their AI agent may do; a mock tool boundary enforces it. Input is bounded everywhere.
export const LIMITS = { toolName: 64, amount: 1_000_000, allowedActions: 4, prefsText: 2048, policy: 8 };

// Action tiers, matching the AI-DEMO2 gate: read = list/get tools, write = create/transfer/redeem tools.
export const ACTIONS = ['read', 'write'];
export const POLICIES = ['allow', 'hitl', 'deny'];
export const DEFAULT_PREFERENCES = { allowedActions: ['read', 'write'], maxAmount: null, detectAgent: true, unknownAgentPolicy: 'hitl' };

export class PrefsInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Normalize raw preferences to the canonical shape. Unknown fields and bad values fall back to defaults (like AI-DEMO2). */
export function normalizePreferences(raw) {
  const prefs = { ...DEFAULT_PREFERENCES, maxAmount: null };
  if (!isObj(raw)) return prefs;
  if (Array.isArray(raw.allowedActions)) {
    const allowed = raw.allowedActions.filter((a) => ACTIONS.includes(a));
    // An explicitly EMPTY list means "no agent actions at all" — keep it; an all-invalid list falls back to defaults.
    if (allowed.length > 0 || raw.allowedActions.length === 0) prefs.allowedActions = ACTIONS.filter((a) => allowed.includes(a));
  }
  if (typeof raw.maxAmount === 'number' && Number.isFinite(raw.maxAmount) && raw.maxAmount >= 0 && raw.maxAmount <= LIMITS.amount) {
    prefs.maxAmount = raw.maxAmount;
  }
  if (typeof raw.detectAgent === 'boolean') prefs.detectAgent = raw.detectAgent;
  if (POLICIES.includes(raw.unknownAgentPolicy)) prefs.unknownAgentPolicy = raw.unknownAgentPolicy;
  return prefs;
}

/**
 * The decision core. `detectedAgent` is the session-start Protect signal: a mock Protect evaluation named an AI agent
 * (rule 660-674 style). Mirrors the AI-DEMO2 evaluatePreferences:
 *   permit | hitl (with a reason) | deny (with a reason)
 */
export function evaluatePreferences({ prefs, requiredTier, amount, detectedAgent }) {
  if (!prefs.allowedActions.includes(requiredTier)) {
    return {
      decision: 'hitl',
      status: 428,
      code: 'agent_preferences_hitl',
      reason: `Agent action tier "${requiredTier}" is not in the user's allowed actions [${prefs.allowedActions.join(', ') || 'none'}]`,
    };
  }
  if (prefs.maxAmount !== null && typeof amount === 'number' && Number.isFinite(amount) && amount > prefs.maxAmount) {
    return {
      decision: 'hitl',
      status: 428,
      code: 'agent_preferences_hitl',
      reason: `Agent action amount ${amount} exceeds the user's preference cap of ${prefs.maxAmount}`,
    };
  }
  const detectionActive = detectedAgent && prefs.detectAgent !== false;
  if (detectionActive && prefs.unknownAgentPolicy === 'deny') {
    return { decision: 'deny', status: 403, code: 'agent_preferences_denied', reason: 'AI agent detected and the user preference is to deny agent actions' };
  }
  if (detectionActive && prefs.unknownAgentPolicy === 'hitl') {
    return { decision: 'hitl', status: 428, code: 'agent_preferences_hitl', reason: 'AI agent detected — user preference requires human approval for agent actions' };
  }
  return { decision: 'permit', status: 200, code: 'agent_preferences_permit', reason: null };
}

// ── Mock Protect: bot detection ───────────────────────────────────────────────
// Shape follows what the AI-DEMO2 Protect browser demo normalizes (details.botDetection.detected.rule.{id,name}).
// Rules 660-674 are the real Protect AI-agent identification rule ids seen in AI-DEMO2; the values here are invented.
export const AGENT_RULES = [
  { id: 660, name: 'AI agent - ChatGPT detected', agent: 'ChatGPT' },
  { id: 661, name: 'AI agent - Claude detected', agent: 'Claude' },
  { id: 674, name: 'AI agent - Muse detected', agent: 'Muse' },
  { id: 670, name: 'AI agent - Skyvern detected', agent: 'Skyvern' },
];

/**
 * Mock Protect evaluation: run the Signals payload shape and return the botDetection block the demo normalizes.
 * `signals` is opaque text here (bounded); the mock always "collects" and decides by the picked rule.
 */
export function evaluateProtectSignals({ ruleId }) {
  const rule = AGENT_RULES.find((r) => r.id === ruleId) || null;
  if (!rule) {
    return {
      level: 'LOW',
      recommendedAction: 'ALLOW',
      botDetection: { level: 'low', status: 'notDetected', detectedRuleId: null, detectedRuleName: null },
      detectedAgent: false,
    };
  }
  return {
    level: 'MEDIUM',
    recommendedAction: 'CHALLENGE',
    botDetection: { level: 'medium', status: 'detected', detectedRuleId: rule.id, detectedRuleName: rule.name },
    detectedAgent: true,
    agent: rule.agent,
  };
}

// ── Tool tier map ─────────────────────────────────────────────────────────────
// Mirrors the AI-DEMO2 rule: riskLevel high/critical in scope topology → write tier; low/medium → read.
export const TOOLS = [
  { name: 'get_my_accounts', tier: 'read', sampleAmount: null },
  { name: 'get_transactions', tier: 'read', sampleAmount: null },
  { name: 'get_loyalty_status', tier: 'read', sampleAmount: null },
  { name: 'create_transfer', tier: 'write', sampleAmount: 750 },
  { name: 'pay_bill', tier: 'write', sampleAmount: 220 },
  { name: 'redeem_miles', tier: 'write', sampleAmount: 1200 },
];

export function getRequiredTier(toolName) {
  if (typeof toolName !== 'string' || toolName.length > LIMITS.toolName) throw new PrefsInputError('bad_tool', 'tool must be short text');
  const tool = TOOLS.find((t) => t.name === toolName);
  return tool ? tool.tier : 'read'; // unknown tools default to read, like AI-DEMO2
}

// ── HITL: the pending-approval challenge, in-process (the AI-DEMO2 contract: 428 + taskId) ──
export function createChallengeStore() {
  const challenges = new Map();
  let seq = 0;
  return {
    create({ tool, reason, userId }) {
      seq += 1;
      const id = `hitl-${String(seq).padStart(4, '0')}`;
      const challenge = { taskId: id, tool, reason, userId, status: 'pending', createdAt: 'mock-time', resolvedAt: null, decidedBy: null };
      challenges.set(id, challenge);
      return challenge;
    },
    get(id) { return challenges.get(String(id)) || null; },
    respond(id, decision, decidedBy) {
      const c = challenges.get(String(id));
      if (!c) return null;
      if (c.status !== 'pending') return c;
      if (decision !== 'approved' && decision !== 'denied') throw new PrefsInputError('bad_decision', "decision must be 'approved' or 'denied'");
      c.status = decision;
      c.resolvedAt = 'mock-time';
      c.decidedBy = typeof decidedBy === 'string' ? decidedBy.slice(0, LIMITS.policy) : 'presenter';
      return c;
    },
    pending() { return [...challenges.values()].filter((c) => c.status === 'pending'); },
    all() { return [...challenges.values()]; },
    reset() { challenges.clear(); seq = 0; },
  };
}
