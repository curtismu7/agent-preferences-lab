// Rule 13: a workspace id keeps one visitor's state apart from another's. Per workspace: the user's agent preferences, the
// session-start Protect detection flag, the single-use HITL receipts, and the recent runs. Bounded in count, size and age.
export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_WORKSPACE = 'default';
export const MAX_RUNS = 20;

export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  return typeof raw === 'string' && WORKSPACE_RE.test(raw) ? raw : null;
}

export function createWorkspaces({ max = 500, ttlMs = 60 * 60 * 1000, now = Date.now, defaults } = {}) {
  const map = new Map(); // id -> { runs, at, preferences, detectedAgent, detectedRule, receipts }
  const sweep = () => {
    const t = now();
    for (const [id, v] of map) { if (t - v.at > ttlMs) map.delete(id); else break; }
    while (map.size > max) map.delete(map.keys().next().value);
  };
  const blank = () => ({
    runs: [],
    preferences: defaults ? { ...defaults } : null, // null = never touched; app falls back to story defaults
    detectedAgent: false,
    detectedRule: null,
    receipts: new Map(), // taskId -> tool (single use)
  });
  return {
    prefs(id) {
      sweep();
      let v = map.get(id);
      if (!v) { v = blank(); map.set(id, v); }
      v.at = now();
      return v;
    },
    setPrefs(id, prefs) {
      const v = this.prefs(id);
      v.preferences = { ...prefs };
      return v.preferences;
    },
    setDetection(id, detectedAgent, botDetection) {
      const v = this.prefs(id);
      v.detectedAgent = detectedAgent === true;
      v.detectedRule = botDetection || null;
      return { detectedAgent: v.detectedAgent, detectedRule: v.detectedRule };
    },
    recordChallenge(id, taskId) { this.prefs(id); },
    approveChallenge(id, taskId, tool) {
      const v = this.prefs(id);
      v.receipts.set(taskId, tool);
    },
    // Single use: an approved receipt discharges the block for ONE retried call of the same tool (AI-DEMO2 receipt-verify rule).
    takeApprovedChallenge(id, tool) {
      const v = this.prefs(id);
      for (const [taskId, t] of v.receipts) {
        if (t === tool) { v.receipts.delete(taskId); return { taskId, tool }; }
      }
      return null;
    },
    runs(id) { sweep(); const v = map.get(id); return { workspace: id, runs: v ? v.runs : [] }; },
    record(id, run) {
      const v = this.prefs(id);
      v.runs = [...v.runs, { ...run, at: now() }].slice(-MAX_RUNS);
      sweep();
      return v.runs;
    },
    reset(id) { map.delete(id); },
    resetWorkspace(id) { map.delete(id); },
    size() { return map.size; },
  };
}
