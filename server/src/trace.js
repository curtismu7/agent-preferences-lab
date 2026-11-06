// Rule 14: W3C Trace Context on every (mock) hop. One trace id per evaluation, a new span id per hop. A valid incoming
// `traceparent` header continues its trace; anything else starts a new one. Nothing is sent anywhere: these are the raw
// request/response panes the UI shows. Values are random, mock, and carry no meaning outside this app.
import { randomBytes } from 'node:crypto';

const TP = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO32 = '0'.repeat(32);
const ZERO16 = '0'.repeat(16);

export function parseTraceparent(v) {
  if (typeof v !== 'string' || v.length !== 55) return null;
  const m = TP.exec(v);
  return m && m[1] !== ZERO32 && m[2] !== ZERO16 ? { traceId: m[1], parentId: m[2], flags: m[3] } : null;
}
export const formatTraceparent = (traceId, spanId, flags = '01') => `00-${traceId}-${spanId}-${flags}`;

export function newTrace(incoming, rand = randomBytes) {
  const p = parseTraceparent(incoming);
  const span = () => rand(8).toString('hex').replace(/^0{16}$/, '0000000000000001');
  return { traceId: p ? p.traceId : rand(16).toString('hex').replace(/^0{32}$/, `${'0'.repeat(31)}1`), parentId: p ? p.parentId : null, span };
}

// The four mock hops of one tool-call evaluation, with the raw request and response text of each.
export function buildHops({ trace, cast, decision, code, reason, tool, detectedAgent, scenario }) {
  const host = `mcp.${cast.castHost}.example`;
  const ids = [trace.span(), trace.span(), trace.span(), trace.span()];
  const tp = ids.map((id) => formatTraceparent(trace.traceId, id));
  const status = decision === 'permit' ? '200 (gate passed; tool executes)' : decision === 'hitl' ? '428 Precondition Required' : '403 Forbidden';
  const detection = detectedAgent ? 'botDetection.detected.rule.name = "AI agent - <type> detected"' : 'botDetection: not detected';
  return [
    { n: 1, from: 'agent', to: 'boundary', label: 'Agent calls the tool boundary', traceparent: tp[0],
      request: `POST https://${host}/api/mcp/tool\nAuthorization: Bearer <MOCK token with act.sub>\nx-mcp-tool: ${tool}\ntraceparent: ${tp[0]}\ncontent-type: application/json`,
      response: `HTTP/1.1 ${status}\ntraceparent: ${tp[0]}` },
    { n: 2, from: 'boundary', to: 'protect', label: 'Session-start Protect signal (mock)', traceparent: tp[1],
      request: `POST /api/protect-auth/evaluations (mock, once per session)\ntraceparent: ${tp[1]}\nsdk.signals.data: <MOCK signals>`,
      response: `level: ${detectedAgent ? 'MEDIUM' : 'LOW'}\n${detection}` },
    { n: 3, from: 'boundary', to: 'prefs', label: 'Gate reads the user agentPreferences', traceparent: tp[2],
      request: `GET /v1/environments/<env>/users/<user> (mock, in process)\ntraceparent: ${tp[2]}\nattribute: agentPreferences`,
      response: `code: ${code}\nreason: ${reason || '(none — permitted)'}\nscenario: ${scenario}` },
    { n: 4, from: 'boundary', to: 'agent', label: 'Gate answers the agent', traceparent: tp[3],
      request: `GATE-RESULT (mock)\ntraceparent: ${tp[3]}`,
      response: `decision: ${decision}\n${decision === 'hitl' ? `taskId: <challenge id> — approve or deny in the approval panel` : decision === 'deny' ? 'the call ends here' : 'the tool call proceeds'}` },
  ];
}
