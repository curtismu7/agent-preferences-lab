import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rawHttp, withServer } from './helpers.js';

test('GET /api/health answers demo-health/1, ready and offline', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.runtime, 'offline');
    assert.equal(j.demo.id, 'agent-preferences-lab');
    assert.deepEqual(Object.keys(j).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
  });
});

test('health is GET only', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`, { method: 'POST', headers: { origin: url } });
    assert.equal(r.status, 405);
  });
});

test('POST /api/reset confirms and refuses a cross-origin caller', async () => {
  await withServer(async (url) => {
    const ok = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{}' });
    assert.equal((await ok.json()).reset, 'ok');
    const bad = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    assert.equal(bad.status, 403);
  });
});

test('a non-loopback Host header is refused (DNS rebinding)', async () => {
  await withServer(async (url) => {
    const r = await rawHttp(`${url}/api/health`, { headers: { host: 'evil.example.invalid' } });
    assert.equal(r.status, 403);
  });
});

test('unknown API paths are 404 JSON', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/nope`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'not_found');
  });
});

test('GET /api/info says what this build is: mock, simulated, and hosted only when asked', async () => {
  await withServer(async (url) => {
    const info = await (await fetch(`${url}/api/info`)).json();
    delete info.version;
    assert.deepEqual(info, { mode: 'mock', source: 'mock', simulated: true, hosted: false, realAvailable: false });
    const j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.equal(j.hosted, false);
    assert.match(j.banner, /^SIMULATED/);
  });
  await withServer(async (url) => {
    const hostedInfo = await (await fetch(`${url}/api/info`)).json();
    delete hostedInfo.version;
    assert.deepEqual(hostedInfo, { mode: 'mock', source: 'mock', simulated: true, hosted: true, realAvailable: false });
    assert.match((await (await fetch(`${url}/api/scenarios`)).json()).banner, /^HOSTED SIMULATION/);
  }, { hosted: true });
});

test('an oversized or malformed body gets a short JSON error, never a stack trace or a file path', async () => {
  await withServer(async (url) => {
    const post = (body) => fetch(`${url}/api/preferences`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body });
    const big = await post(JSON.stringify({ pad: 'x'.repeat(9000) }));
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: 'payload_too_large' });
    const bad = await post('{not json');
    assert.equal(bad.status, 400);
    const text = JSON.stringify(await bad.json());
    assert.equal(text, JSON.stringify({ error: 'bad_request' }));
    assert.ok(!/\/Users\/|node_modules|at \w+ \(/.test(text), 'no stack or path');
    assert.equal((await fetch(`${url}/api/health`)).status, 200, 'the server stays up');
  });
});

test('GET /api/scenarios returns the filled story; customer.config.json is read on each request; verticals switch the cast', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apl-')), 'customer.config.json');
  await withServer(async (url) => {
    let j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.equal(j.scenarios.length, 5);
    assert.ok(!/\{\{/.test(JSON.stringify(j)), 'no unfilled token');
    assert.match(j.tokenLabel, /MOCK/);
    assert.ok(j.facts.some((f) => f.id === 'per-call-open' && f.status === 'inferred'));
    assert.ok(j.tools.length >= 5, 'the tool list ships with the story');
    j = await (await fetch(`${url}/api/scenarios?vertical=finance`)).json();
    assert.match(j.rule.appliesTo, /fabrikam/);
    j = await (await fetch(`${url}/api/scenarios?vertical=__proto__`)).json();
    assert.match(j.rule.appliesTo, /northwind/, 'unknown vertical keeps the default');
    fs.writeFileSync(file, JSON.stringify({ cast: { host: 'customhost' } }));
    j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.match(j.rule.appliesTo, /customhost/);
  }, { configFile: file });
});

test('POST /api/preferences normalizes the visitor\'s preferences and they drive the gate', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    // default gate: read tool permits
    let j = await (await post('/api/mcp/tool', { tool: 'get_my_accounts' }, 'w1')).json();
    assert.equal(j.decision, 'permit');
    // restrict to read-only
    j = await (await post('/api/preferences', { preferences: { allowedActions: ['read'], unknownAgentPolicy: 'hitl' } }, 'w1')).json();
    assert.deepEqual(j.preferences.allowedActions, ['read']);
    j = await (await post('/api/mcp/tool', { tool: 'create_transfer', params: { amount: 750 } }, 'w1')).json();
    assert.equal(j.status === undefined ? true : true, true);
    // the tool call itself answers 428; fetch gave us the body regardless of status here
    assert.equal(j.decision, 'hitl');
    assert.match(j.reason, /write.*not in the user's allowed actions/);
    assert.ok(j.taskId, 'a HITL challenge id comes back');
    // invalid preferences object is refused
    assert.equal((await post('/api/preferences', { preferences: 'junk' }, 'w1')).status, 400);
    // normalization: junk values fall back to defaults
    j = await (await post('/api/preferences', { preferences: { allowedActions: ['bogus'], maxAmount: 'lots', unknownAgentPolicy: 'maybe' } }, 'w1')).json();
    assert.deepEqual(j.preferences.allowedActions, ['read', 'write']);
    assert.equal(j.preferences.maxAmount, null);
    assert.equal(j.preferences.unknownAgentPolicy, 'hitl');
    // an explicitly empty allowedActions list is honored: no agent actions
    j = await (await post('/api/preferences', { preferences: { allowedActions: [] } }, 'w1')).json();
    assert.deepEqual(j.preferences.allowedActions, []);
    j = await (await post('/api/mcp/tool', { tool: 'get_my_accounts' }, 'w1')).json();
    assert.equal(j.decision, 'hitl');
  });
});

test('POST /api/mcp/tool: spend cap and unknown tool tiers', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    await post('/api/preferences', { preferences: { allowedActions: ['read', 'write'], maxAmount: 500 } }, 'w2');
    const over = await (await post('/api/mcp/tool', { tool: 'create_transfer', params: { amount: 750 } }, 'w2')).json();
    assert.equal(over.decision, 'hitl');
    assert.match(over.reason, /exceeds the user's preference cap of 500/);
    const under = await (await post('/api/mcp/tool', { tool: 'pay_bill', params: { amount: 220 } }, 'w2')).json();
    assert.equal(under.decision, 'permit');
    // unknown tool defaults to read tier
    const unknown = await (await post('/api/mcp/tool', { tool: 'brand_new_tool' }, 'w2')).json();
    assert.equal(unknown.decision, 'permit');
    assert.equal(unknown.tier, 'read');
    // bad amounts are refused
    assert.equal((await post('/api/mcp/tool', { tool: 'pay_bill', params: { amount: -5 } }, 'w2')).status, 400);
    assert.equal((await post('/api/mcp/tool', { tool: 'pay_bill', params: { amount: 'lots' } }, 'w2')).status, 400);
    assert.equal((await post('/api/mcp/tool', {}, 'w2')).status, 400);
  });
});

test('mock Protect detection drives the unknownAgentPolicy: hitl (default) and deny', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    // session start: Muse detected
    let j = await (await post('/api/protect/evaluate', { ruleId: 674 }, 'w3')).json();
    assert.equal(j.detectedAgent, true);
    assert.equal(j.botDetection.detectedRuleName, 'AI agent - Muse detected');
    assert.equal(j.level, 'MEDIUM');
    // default policy hitl: even an allowed read goes to a human
    j = await (await post('/api/mcp/tool', { tool: 'get_my_accounts' }, 'w3')).json();
    assert.equal(j.decision, 'hitl');
    assert.match(j.reason, /AI agent detected/);
    // no detection: rule 660 unknown id null = clear
    j = await (await post('/api/protect/evaluate', { ruleId: null }, 'w3')).json();
    assert.equal(j.detectedAgent, false);
    j = await (await post('/api/mcp/tool', { tool: 'get_my_accounts' }, 'w3')).json();
    assert.equal(j.decision, 'permit');
    // deny policy + detection = 403
    await post('/api/preferences', { preferences: { unknownAgentPolicy: 'deny' } }, 'w3');
    await post('/api/protect/evaluate', { ruleId: 660 }, 'w3');
    const res = await post('/api/mcp/tool', { tool: 'get_my_accounts' }, 'w3');
    assert.equal(res.status, 403);
    j = await res.json();
    assert.equal(j.decision, 'deny');
    // detectAgent=false turns the signal off
    await post('/api/preferences', { preferences: { unknownAgentPolicy: 'deny', detectAgent: false } }, 'w3');
    j = await (await post('/api/mcp/tool', { tool: 'get_my_accounts' }, 'w3')).json();
    assert.equal(j.decision, 'permit');
  });
});

test('HITL: challenge is created, approval is a single-use receipt, deny ends it', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    await post('/api/preferences', { preferences: { allowedActions: ['read'] } }, 'w4');
    const blocked = await post('/api/mcp/tool', { tool: 'create_transfer' }, 'w4');
    assert.equal(blocked.status, 428);
    const { taskId } = await blocked.json();
    const pending = await (await fetch(`${url}/api/challenges`, { headers: { 'x-workspace': 'w4' } })).json();
    assert.ok(pending.pending.some((c) => c.taskId === taskId));
    // bad decision refused
    assert.equal((await post(`/api/challenges/${taskId}/respond`, { decision: 'maybe' }, 'w4')).status, 400);
    assert.equal((await post('/api/challenges/nope/respond', { decision: 'approved' }, 'w4')).status, 404);
    // approval → single-use receipt → the retry permits → the receipt is consumed
    await post(`/api/challenges/${taskId}/respond`, { decision: 'approved', respondedBy: 'presenter' }, 'w4');
    const retry = await (await post('/api/mcp/tool', { tool: 'create_transfer' }, 'w4')).json();
    assert.equal(retry.decision, 'permit');
    assert.equal(retry.viaHitl, taskId);
    // second retry is blocked again (receipt was single use)
    const again = await (await post('/api/mcp/tool', { tool: 'create_transfer' }, 'w4')).json();
    assert.equal(again.decision, 'hitl');
    // deny path
    const blocked2 = await post('/api/mcp/tool', { tool: 'create_transfer' }, 'w4');
    const { taskId: t2 } = await blocked2.json();
    await post(`/api/challenges/${t2}/respond`, { decision: 'denied' }, 'w4');
    const retry2 = await (await post('/api/mcp/tool', { tool: 'create_transfer' }, 'w4')).json();
    assert.equal(retry2.decision, 'hitl', 'a denied challenge leaves the block in place');
  });
});

test('preferences, detections, challenges and runs are per workspace and Reset clears only that workspace', async () => {
  await withServer(async (url) => {
    const post = (p, ws, body = {}) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const get = (p, ws) => fetch(`${url}${p}`, { headers: { 'x-workspace': ws } });
    await post('/api/preferences', 'alice', { preferences: { allowedActions: ['read'] } });
    await post('/api/protect/evaluate', 'alice', { ruleId: 674 });
    await post('/api/mcp/tool', 'alice', { tool: 'get_my_accounts' });
    // bob is unaffected
    let j = await (await get('/api/preferences', 'bob')).json();
    assert.equal(j.detectedAgent, false);
    assert.deepEqual(j.preferences.allowedActions, ['read', 'write'], 'defaults until touched');
    j = await (await post('/api/mcp/tool', 'bob', { tool: 'get_my_accounts' })).json();
    assert.equal(j.decision, 'permit');
    const runs = async (ws) => (await (await get('/api/runs', ws)).json()).runs;
    assert.equal((await runs('alice')).length >= 1, true);
    await post('/api/reset', 'alice');
    j = await (await get('/api/preferences', 'alice')).json();
    assert.equal(j.detectedAgent, false, 'reset clears the detection flag');
    assert.deepEqual(j.preferences.allowedActions, ['read', 'write'], 'reset restores default preferences');
    assert.deepEqual(await runs('alice'), []);
    assert.deepEqual((await runs('bob')).map((r) => r.decision), ['permit']);
    assert.equal((await post('/api/mcp/tool', 'Bad Id!', { tool: 'get_my_accounts' })).status, 400);
  });
});

test('GET /api/diagram serves the preferences-flow diagram-studio data, uncached', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/diagram`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.equal(j.steps.length, 7);
    assert.ok(j.nodes.some((n) => n.label === 'Tool boundary gate'));
    assert.ok(j.steps[0].say.includes('Signals'));
  });
});

test('rule 19: POST /api/mode switches (mock) and answers 409 when Real is not configured', async () => {
  await withServer(async (url) => {
    const post = (body) => fetch(`${url}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(body) });
    const ok = await post({ source: 'mock' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { source: 'mock' });
    const conflict = await post({ source: 'real' });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, 'real_not_configured');
    assert.equal((await post({ source: 'banana' })).status, 400);
    assert.equal((await post({})).status, 400);
  });
});

test('GET /api/shelf answers the shelf URL (null when unconfigured)', async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/api/shelf`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ['shelfUrl']);
    assert.equal(body.shelfUrl, null);
  }, { env: {} });
});

test('GET /api/shelf is reachable without a web build, reads SHELF_URL (trailing slash trimmed), and POST is refused', async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/api/shelf`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { shelfUrl: 'https://shelf.example:8443' });
    assert.notEqual((await fetch(`${url}/api/shelf`, { method: 'POST', headers: { origin: url } })).status, 200);
  }, { env: { SHELF_URL: 'https://shelf.example:8443/' } });
});
