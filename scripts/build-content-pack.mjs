// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const story = buildStory(DEFAULT_CAST);
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const terms = { 'allowed-read': ['agent-preferences'], 'write-blocked': ['hitl'], 'over-cap': ['hitl', 'agent-preferences'], 'protect-hitl': ['agent-detection', 'hitl'], 'protect-deny': ['agent-detection'] };
  return {
    schema: 'demo-content-pack/1',
    id: 'agent-preferences-lab',
    title: 'Agent Preferences Lab',
    version,
    demo: { id: 'agent-preferences-lab', name: 'Agent Preferences Lab', catalog: 'D999', baseUrl: 'http://localhost:7660', doctor: '/api/health', tags: ['mcp', 'agent', 'preferences', 'protect', 'hitl', 'mock-only'] },
    glossary: [
      { id: 'agent-preferences', term: 'agentPreferences', definition: 'The user\'s preference, stored as a JSON attribute on their directory user: allowedActions (action tiers), maxAmount (spend cap), detectAgent, unknownAgentPolicy (allow / hitl / deny for a detected AI agent).', aliases: ['agent preferences'] },
      { id: 'hitl', term: 'HITL (human in the loop)', definition: 'A blocked-but-approvable agent action is answered HTTP 428 with a task id; a human approves or denies. An approval is a single-use receipt: the retried call passes once.', aliases: ['human approval', '428'] },
      { id: 'agent-detection', term: 'Protect agent detection', definition: "PingOne Protect's bot detection names the AI agent type (rules 660-674, e.g. \"AI agent - Muse detected\") when the Signals SDK runs with agent identification. In AI-DEMO2 it is a session-start signal; per-call evaluation is an open question.", aliases: ['bot detection', 'rules 660-674'] },
    ],
    sources: [
      { id: 'rfc8693', title: 'RFC 8693: OAuth 2.0 Token Exchange', url: 'https://www.rfc-editor.org/rfc/rfc8693', kind: 'standard', use: 'Defines the act (actor) claim that marks a call as agent-originated.', status: 'not-read', checked: '2026-11-06' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Scenario ${i + 1}: ${sc.title}`, description: sc.lesson, group: 'try-it', action: { type: 'route', href: `/#scenario-${sc.id}` }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'concept-editor', label: 'Set your own preferences', description: 'Edit allowed tiers, the spend cap and the unknown-agent policy; the gate answers on the next tool call.', group: 'concept', action: { type: 'route', href: '/#gate' } },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.lesson })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
}
