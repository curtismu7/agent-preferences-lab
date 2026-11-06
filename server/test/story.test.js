import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAST, VERTICALS, fill, unfilled } from '../src/cast.js';
import { rawStory, buildStory } from '../src/story.js';
import { evaluatePreferences, normalizePreferences, getRequiredTier, TOOLS } from '../src/preferences.js';
import { scanHosts } from '../src/safety.js';
import { rawDiagram } from '../src/diagramData.js';

const all = () => JSON.stringify([rawStory(), rawDiagram()]);

test('every {{token}} in the story and diagram data is defined by every vertical (fails on an undefined token)', () => {
  for (const [name, cast] of Object.entries(VERTICALS)) assert.deepEqual(unfilled(all(), cast), [], name);
  assert.equal(Object.keys(VERTICALS).length, 3);
});

test('the check itself catches an undefined token and leaves it visible', () => {
  assert.deepEqual(unfilled('a {{castBrand}} {{nope}}', DEFAULT_CAST), ['nope']);
  assert.equal(fill('{{nope}}', DEFAULT_CAST), '{{nope}}');
  assert.equal(fill('{{__proto__}}', DEFAULT_CAST), '{{__proto__}}');
});

test('each scenario gives its expected decision in every vertical', () => {
  for (const cast of Object.values(VERTICALS)) {
    const s = buildStory(cast);
    for (const sc of s.scenarios) {
      const tool = TOOLS.find((t) => t.name === sc.tool);
      const decision = evaluatePreferences({
        prefs: normalizePreferences(sc.preferences),
        requiredTier: getRequiredTier(sc.tool),
        amount: tool ? tool.sampleAmount : null,
        detectedAgent: sc.detectedAgent === true,
      }).decision;
      assert.equal(decision, sc.expected, sc.id);
    }
  }
});

test('the protect-deny scenario really carries unknownAgentPolicy deny, and allowed-read carries none', () => {
  const s = buildStory(DEFAULT_CAST).scenarios;
  assert.equal(s.find((x) => x.id === 'protect-deny').preferences.unknownAgentPolicy, 'deny');
  assert.equal(s.find((x) => x.id === 'allowed-read').detectedAgent, false);
  assert.equal(s.find((x) => x.id === 'protect-hitl').detectedAgent, true);
});

test('only .example hosts, no key-looking values', () => {
  assert.deepEqual(scanHosts(JSON.stringify([buildStory(DEFAULT_CAST)])), []);
  assert.deepEqual(scanHosts(all()), []);
});

test('the per-call-open claim is labelled inferred (open question) and the enforced ones measured', () => {
  const facts = rawStory().facts;
  assert.equal(facts.find((f) => f.id === 'per-call-open').status, 'inferred');
  assert.equal(facts.find((f) => f.id === 'attribute').status, 'measured');
  assert.equal(facts.find((f) => f.id === 'protect-signal').status, 'measured');
  assert.ok(!/\bdoors?\b/i.test(all()));
});

test('docs/talk-track.md is exactly what the talk-track data renders (no drift; run `npm run talk-track`)', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const md = readFileSync(path.resolve(import.meta.dirname, '../../docs/talk-track.md'), 'utf8');
  const { renderTalkTrackMarkdown } = await import('../src/story.js');
  assert.equal(md, renderTalkTrackMarkdown(DEFAULT_CAST));
});

test('the diagram is diagram-studio/1 data and every step walks a real edge', () => {
  const d = rawDiagram();
  assert.equal(d.schema, 'diagram-studio/1');
  assert.equal(d.steps.length, 7);
  for (const s of d.steps) for (const i of s.edges) assert.ok(d.edges[i], `${s.title} edge ${i}`);
});
