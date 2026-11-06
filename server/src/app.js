// One Express app. /api = health, preferences, protect detection, evaluate, challenges, diagram, info and reset. The only server
// state is each workspace's preferences, detection flag, challenges and recent runs, kept per workspace id (X-Workspace) so one
// visitor's Reset never touches another's. Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { loadCast, verticalFrom, VERTICALS } from './cast.js';
import { hostedFrom, modeFrom, realAvailableFrom } from './config.js';
import { buildStory } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import {
  PrefsInputError, createChallengeStore, evaluatePreferences, evaluateProtectSignals,
  getRequiredTier, normalizePreferences, DEFAULT_PREFERENCES, TOOLS,
} from './preferences.js';
import { buildHops, newTrace } from './trace.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

export function createApp({ health = createHealth(), configFile = CONFIG, hosted = false, workspaces = createWorkspaces(), challenges = createChallengeStore() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use('/health', health.router);
  const castFor = (req) => loadCast(configFile, verticalFrom(req.query.vertical));
  // customer.config.json is read on every request so editing it shows up on reload.
  api.get('/scenarios', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...buildStory(castFor(req), { hosted }), verticals: Object.keys(VERTICALS), hosted }); });
  api.get('/diagram', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : 'preferences-flow')); });
  // What this build is, for the banner and for verifying a deploy by content (not by a 200).
  api.get('/info', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ mode: modeFrom(), source: modeFrom(), simulated: true, hosted, realAvailable: realAvailableFrom() }); });
  // Rule 19: the Mock/Real toggle. Exactly { source: "mock"|"real" }; 409 when Real is not configured.
  api.post('/mode', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !['mock', 'real'].includes(body.source)) {
      return res.status(400).json({ error: 'bad_source', detail: 'body must be exactly { source: "mock" | "real" }' });
    }
    if (body.source === 'real' && !realAvailableFrom()) {
      return res.status(409).json({ error: 'real_not_configured', detail: 'Real mode needs REAL_PINGONE_ENV_ID, REAL_PINGONE_WORKER_ID and REAL_PINGONE_WORKER_SECRET in the environment (owner-run). Mock keeps working.' });
    }
    return res.json({ source: body.source });
  });

  const withWorkspace = (handler) => (req, res) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    res.set('Cache-Control', 'no-store');
    return handler(ws, req, res);
  };

  // Read the workspace's current preferences and detection flag. Null preferences mean "never touched" → the story defaults.
  api.get('/preferences', withWorkspace((ws, _req, res) => {
    const wsState = workspaces.prefs(ws);
    res.json({ preferences: wsState.preferences || DEFAULT_PREFERENCES, detectedAgent: wsState.detectedAgent, detectedRule: wsState.detectedRule, tools: TOOLS, workspace: ws });
  }));

  // Set the workspace's preferences (the admin PATCH in AI-DEMO2; here the visitor IS the user). Body is normalized.
  api.post('/preferences', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (body.preferences !== undefined && (typeof body.preferences !== 'object' || Array.isArray(body.preferences) || body.preferences === null)) {
      return res.status(400).json({ error: 'bad_preferences', detail: 'preferences must be a JSON object' });
    }
    const prefs = normalizePreferences(body.preferences ?? body);
    workspaces.setPrefs(ws, prefs);
    if (body.resetDetection === true) workspaces.setDetection(ws, false, null);
    return res.json({ preferences: prefs, workspace: ws });
  }));

  // Mock Protect evaluation: the session-start signal. Body { ruleId } picks which bot-detection rule fired (null = none).
  api.post('/protect/evaluate', withWorkspace((ws, req, res) => {
    const body = req.body || {};
    if (body.ruleId !== undefined && body.ruleId !== null && !Number.isInteger(body.ruleId)) {
      return res.status(400).json({ error: 'bad_rule', detail: 'ruleId must be an integer or null' });
    }
    const result = evaluateProtectSignals({ ruleId: body.ruleId ?? null });
    workspaces.setDetection(ws, result.detectedAgent, result.botDetection);
    const trace = newTrace(req.headers.traceparent);
    const hops = buildHops({ trace, cast: castFor(req), decision: result.detectedAgent ? 'detected' : 'clear', code: 'protect_session_start', reason: result.botDetection.detectedRuleName, tool: '(session start)', detectedAgent: result.detectedAgent, scenario: 'protect-evaluate' });
    res.set('traceparent', hops[0].traceparent);
    return res.json({ ...result, workspace: ws, traceId: trace.traceId, hops });
  }));

  // The gate: one agent tool call against the workspace's preferences + detection flag. Mirrors the AI-DEMO2 contract:
  // permit → 200, hitl → 428 + taskId, deny → 403. An approved challenge for the same tool lets the retry pass (like the real HITL receipt).
  api.post('/mcp/tool', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (typeof body.tool !== 'string' || !body.tool) return res.status(400).json({ error: 'tool_name_required', detail: 'body.tool must be non-empty text' });
    let amount = null;
    if (body.params && typeof body.params === 'object' && !Array.isArray(body.params) && body.params.amount !== undefined) {
      amount = Number(body.params.amount);
      if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'bad_amount', detail: 'params.amount must be a non-negative number' });
    }
    // HITL receipt: an approved challenge for this tool discharges the block once (single use, like AI-DEMO2's receipt verify).
    const approved = workspaces.takeApprovedChallenge(ws, body.tool);
    const wsState = workspaces.prefs(ws);
    const tier = getRequiredTier(body.tool);
    const result = approved
      ? { decision: 'permit', status: 200, code: 'agent_preferences_permit', reason: null, viaHitl: approved.taskId }
      : evaluatePreferences({ prefs: wsState.preferences || DEFAULT_PREFERENCES, requiredTier: tier, amount, detectedAgent: wsState.detectedAgent });

    let challenge = null;
    if (result.decision === 'hitl') {
      challenge = challenges.create({ tool: body.tool, reason: result.reason, userId: ws });
      workspaces.recordChallenge(ws, challenge.taskId);
    }
    workspaces.record(ws, { tool: body.tool, tier, decision: result.decision, amount, detectedAgent: wsState.detectedAgent });
    const trace = newTrace(req.headers.traceparent);
    const hops = buildHops({ trace, cast: castFor(req), decision: result.decision, code: result.code, reason: result.reason, tool: body.tool, detectedAgent: wsState.detectedAgent, scenario: approved ? `hitl-retry:${approved.taskId}` : (body.scenario || 'custom') });
    res.set('traceparent', hops[0].traceparent);
    return res.status(result.status).json({
      decision: result.decision, code: result.code, reason: result.reason, tier, tool: body.tool, amount,
      ...(challenge ? { taskId: challenge.taskId } : {}),
      ...(approved ? { viaHitl: approved.taskId } : {}),
      workspace: ws, traceId: trace.traceId, hops,
    });
  }));

  // Challenges: list + respond (the approval panel). An approval is stored on the workspace as a single-use receipt.
  api.get('/challenges', withWorkspace((ws, _req, res) => res.json({ pending: challenges.pending(), all: challenges.all(), workspace: ws })));
  api.post('/challenges/:id/respond', withWorkspace((ws, req, res) => {
    const body = req.body || {};
    try {
      const c = challenges.respond(req.params.id, body.decision, body.respondedBy);
      if (!c) return res.status(404).json({ error: 'not_found' });
      if (c.status === 'approved') workspaces.approveChallenge(ws, c.taskId, c.tool);
      return res.json({ challenge: c, workspace: ws });
    } catch (e) {
      if (e instanceof PrefsInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));

  api.get('/runs', withWorkspace((ws, _req, res) => res.json(workspaces.runs(ws))));
  // Reset clears this workspace's preferences (back to defaults), detection flag, challenges and runs.
  api.post('/reset', withWorkspace((ws, _req, res) => { workspaces.resetWorkspace(ws); challenges.reset(); res.json({ reset: 'ok', workspace: ws }); }));
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  // Errors become short JSON. Express's default handler would send an HTML stack trace with absolute file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
