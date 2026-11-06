import { useCallback, useEffect, useRef, useState } from "react";
import Json from "./Json";
import { runTool, getPreferences, setPreferences, evaluateProtect, respondChallenge, listChallenges } from "../api";
import { visible } from "../safeText";

const STATUS_CLASS = { measured: "tag tag--ok", inferred: "tag", UNVERIFIED: "tag tag--warn" };

export function Hops({ hops, traceId }) {
  return (
    <section aria-label="Mock hops with traceparent" data-testid="hops">
      <h3>Hops (W3C traceparent) <span className="muted">trace {traceId}</span></h3>
      {hops.map((h) => (
        <details key={h.n} open={h.n === 1}>
          <summary>{h.n}. {h.label}</summary>
          <p className="muted">Request</p><Json value={h.request} label={`Request of hop ${h.n}`} />
          <p className="muted">Response</p><Json value={h.response} label={`Response of hop ${h.n}`} />
        </details>
      ))}
    </section>
  );
}

export function Verdict({ run }) {
  if (!run) return <p className="muted" data-testid="verdict-empty">Pick a scenario to run it.</p>;
  const cls = run.decision === "permit" ? "allow" : run.decision === "deny" ? "deny" : "hitl";
  const word = run.decision === "permit" ? "PERMIT" : run.decision === "deny" ? "DENY" : "HITL — human approval";
  return (
    <div className={`verdict verdict--${cls}`} data-testid="verdict" role="status">
      <strong className="verdict__word">{word}</strong>
      <span> HTTP {run.status}</span>
      {run.reason && <p className="reason" data-reason={run.code}>{visible(run.reason)}</p>}
      {run.taskId && <p>Challenge <code>{visible(run.taskId)}</code> created — approve or deny in the Approval panel.</p>}
      {run.viaHitl && <p>Passed on an approved challenge: <code>{visible(run.viaHitl)}</code> (single use).</p>}
    </div>
  );
}

/** Preference editor: allowed tiers, spend cap, unknown-agent policy. The visitor IS the user here. */
function PreferenceEditor({ current, onSaved }) {
  const [prefs, setPrefs] = useState(current);
  const [msg, setMsg] = useState(null);
  useEffect(() => setPrefs(current), [current]);
  const toggleTier = (tier) => {
    const has = prefs.allowedActions.includes(tier);
    const next = has ? prefs.allowedActions.filter((t) => t !== tier) : [...prefs.allowedActions, tier];
    setPrefs({ ...prefs, allowedActions: next });
  };
  const save = async () => {
    setMsg(null);
    const maxAmount = prefs.maxAmount === "" || prefs.maxAmount === null ? null : Number(prefs.maxAmount);
    const res = await setPreferences({ ...prefs, maxAmount }).catch(() => ({ ok: false }));
    setMsg(res.ok ? "Preferences saved — every agent tool call is now measured against them." : "Could not save preferences.");
    if (res.ok) onSaved(res.body.preferences);
  };
  return (
    <section className="panel" aria-labelledby="pref-h" data-testid="pref-editor">
      <h2 id="pref-h">Your agent preferences</h2>
      <p className="muted">What your AI agent may do. These drive the gate on every agent tool call — this is the mock of the agentPreferences user attribute.</p>
      <fieldset>
        <legend>Allowed action tiers</legend>
        <label className="chk"><input type="checkbox" checked={prefs.allowedActions.includes("read")} onChange={() => toggleTier("read")} /> read (list / get)</label>
        <label className="chk"><input type="checkbox" checked={prefs.allowedActions.includes("write")} onChange={() => toggleTier("write")} /> write (transfer / pay / redeem)</label>
      </fieldset>
      <label htmlFor="pref-cap">Spend cap per action (USD, empty = no cap)</label>
      <input id="pref-cap" type="number" min="0" step="1" value={prefs.maxAmount ?? ""} onChange={(e) => setPrefs({ ...prefs, maxAmount: e.target.value === "" ? null : e.target.value })} />
      <fieldset>
        <legend>When Protect detects an AI agent in the session</legend>
        <label className="chk"><input type="radio" name="uap" checked={prefs.unknownAgentPolicy === "allow"} onChange={() => setPrefs({ ...prefs, unknownAgentPolicy: "allow" })} /> allow agent actions</label>
        <label className="chk"><input type="radio" name="uap" checked={prefs.unknownAgentPolicy === "hitl"} onChange={() => setPrefs({ ...prefs, unknownAgentPolicy: "hitl" })} /> approval required (HITL)</label>
        <label className="chk"><input type="radio" name="uap" checked={prefs.unknownAgentPolicy === "deny"} onChange={() => setPrefs({ ...prefs, unknownAgentPolicy: "deny" })} /> agent denied</label>
        <label className="chk"><input type="checkbox" checked={prefs.detectAgent !== false} onChange={(e) => setPrefs({ ...prefs, detectAgent: e.target.checked })} /> use the Protect detection signal</label>
      </fieldset>
      <button type="button" onClick={save} data-testid="pref-save">Save preferences</button>
      {msg && <p className="muted" role="status" data-testid="pref-msg">{msg}</p>}
    </section>
  );
}

/** Mock Protect: fire the session-start signal with a picked bot-detection rule. */
function ProtectPanel({ detected, detectedRule, onEvaluated }) {
  const rules = [
    { id: null, label: "No agent detected (clear session)" },
    { id: 660, label: "AI agent - ChatGPT detected" },
    { id: 661, label: "AI agent - Claude detected" },
    { id: 674, label: "AI agent - Muse detected" },
  ];
  const [pick, setPick] = useState(rules[0].id);
  const [result, setResult] = useState(null);
  const run = async () => {
    const res = await evaluateProtect({ ruleId: pick }).catch(() => null);
    if (res) { setResult(res.body); onEvaluated(res); }
  };
  return (
    <section className="panel" aria-labelledby="protect-h" data-testid="protect-panel">
      <h2 id="protect-h">Session start: mock Protect evaluation</h2>
      <p className="muted">Once per session the browser sends Signals; bot detection names the agent type (rules 660-674). The result flags the session for every later agent call. MOCK — no Signals SDK, no Protect tenant.</p>
      {detected && <p className="tag tag--warn" data-testid="detection-flag">Session flagged: {visible(detectedRule?.detectedRuleName || "an AI agent was detected")}</p>}
      {!detected && <p className="tag tag--ok">Session clear: no agent detected</p>}
      <label htmlFor="protect-rule">Bot detection rule that fired</label>
      <select id="protect-rule" value={pick ?? ""} onChange={(e) => setPick(e.target.value === "" ? null : Number(e.target.value))}>
        {rules.map((r) => <option key={String(r.id)} value={r.id ?? ""}>{r.label}</option>)}
      </select>
      <button type="button" onClick={run} data-testid="protect-run">Run the session-start evaluation</button>
      {result && <Json value={result.botDetection} label="botDetection (mock)" testId="protect-result" />}
    </section>
  );
}

/** The tool boundary: pick a tool (and amount), run it through the gate. */
function ToolCall({ tools, onResult }) {
  const [tool, setTool] = useState(tools[0].name);
  const [amount, setAmount] = useState("");
  const [fail, setFail] = useState(null);
  const current = tools.find((t) => t.name === tool) || tools[0];
  const run = async () => {
    setFail(null);
    const params = amount !== "" ? { amount: Number(amount) } : {};
    const res = await runTool({ tool, params, scenario: "custom" }).catch(() => ({ ok: false, status: 0, body: {} }));
    if (res.ok || res.body.decision) onResult(res.body);
    else setFail(`Could not call the gate (${res.body.error || res.status}).`);
  };
  return (
    <section className="panel" aria-labelledby="call-h" data-testid="tool-call">
      <h2 id="call-h">Call the tool boundary</h2>
      <p className="muted">One agent-originated tool call: the gate measures it against your preferences and the session detection flag.</p>
      <label htmlFor="call-tool">Tool</label>
      <select id="call-tool" value={tool} onChange={(e) => { setTool(e.target.value); setAmount(""); }}>
        {tools.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.tier}{t.sampleAmount ? `, sample amount ${t.sampleAmount}` : ""})</option>)}
      </select>
      {current.sampleAmount !== null && (
        <>
          <label htmlFor="call-amount">Amount (USD)</label>
          <input id="call-amount" type="number" min="0" value={amount === "" ? current.sampleAmount : amount} onChange={(e) => setAmount(e.target.value)} />
        </>
      )}
      <button type="button" onClick={run} data-testid="call-run">Call as the agent</button>
      {fail && <p className="field-error" role="alert">{fail}</p>}
    </section>
  );
}

/** Approval panel: pending HITL challenges, approve or deny. */
function ApprovalPanel({ onChanged, refreshSignal }) {
  const [challenges, setChallenges] = useState({ pending: [], all: [] });
  const refresh = useCallback(async () => { const j = await listChallenges().catch(() => null); if (j) setChallenges(j); }, []);
  useEffect(() => { refresh(); }, [refresh, refreshSignal]);
  const respond = async (id, decision) => {
    await respondChallenge(id, { decision, respondedBy: "presenter" }).catch(() => null);
    await refresh();
    onChanged();
  };
  return (
    <section className="panel" aria-labelledby="hitl-h" data-testid="approval-panel">
      <h2 id="hitl-h">Human approval (HITL)</h2>
      <p className="muted">Blocked-but-approvable calls land here as challenges. Approval is a single-use receipt: the retried call passes once.</p>
      {challenges.pending.length === 0 && <p className="muted" data-testid="no-pending">No pending challenges.</p>}
      <ul className="challenges" data-testid="challenge-list">
        {challenges.pending.map((c) => (
          <li key={c.taskId}>
            <code>{c.taskId}</code> — {c.tool}: <span className="reason">{c.reason}</span>
            <span className="row-btns">
              <button type="button" onClick={() => respond(c.taskId, "approved")}>Approve</button>
              <button type="button" onClick={() => respond(c.taskId, "denied")}>Deny</button>
            </span>
          </li>
        ))}
      </ul>
      {challenges.all.length > 0 && <details><summary>{challenges.all.length} resolved challenge(s)</summary><Json value={challenges.all.filter((c) => c.status !== "pending")} label="Resolved challenges" /></details>}
    </section>
  );
}

function CustomPrefs({ onResult, resetSignal }) {
  const scenario = { preferences: null };
  return scenario;
}

export default function PreferencesGate({ story, resetSignal, requestedId, onSelect, live }) {
  const known = (v) => story.scenarios.some((s) => s.id === v);
  const [id, setId] = useState(known(requestedId) ? requestedId : story.scenarios[0].id);
  useEffect(() => { if (known(requestedId)) setId(requestedId); }, [requestedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [prefs, setPrefsState] = useState(null);
  const [detected, setDetected] = useState({ detectedAgent: false, detectedRule: null });
  const [run, setRun] = useState(null);
  const [fail, setFail] = useState(null);
  const scenario = story.scenarios.find((s) => s.id === id) || story.scenarios[0];

  const loadPrefs = useCallback(async () => {
    const j = await getPreferences().catch(() => null);
    if (j) { setPrefsState(j.preferences); setDetected({ detectedAgent: j.detectedAgent, detectedRule: j.detectedRule }); }
  }, []);
  useEffect(() => { loadPrefs(); }, [loadPrefs, resetSignal]);

  // Run a shipped scenario: set its preferences + detection, then call the tool — exactly what the gate measures.
  // A run token drops a stale in-flight chain when the visitor switches scenarios mid-run.
  const runToken = useRef(0);
  const runScenario = useCallback(async (sid) => {
    const token = ++runToken.current;
    const drop = () => token !== runToken.current;
    setFail(null);
    const sc = story.scenarios.find((s) => s.id === sid) || story.scenarios[0];
    const saved = await setPreferences({ ...sc.preferences, resetDetection: true }).catch(() => null);
    if (drop()) return;
    if (saved) setPrefsState(saved.body.preferences);
    const ev = await evaluateProtect({ ruleId: sc.detectedAgent ? 674 : null }).catch(() => null);
    if (drop()) return;
    if (ev) setDetected((prev) => (token !== runToken.current ? prev : { detectedAgent: ev.body.detectedAgent, detectedRule: ev.body.botDetection }));
    const tool = story.tools.find((t) => t.name === sc.tool) || story.tools[0];
    const res = await runTool({ tool: sc.tool, params: tool.sampleAmount !== null ? { amount: tool.sampleAmount } : {}, scenario: sc.id }).catch(() => ({ ok: false, status: 0, body: {} }));
    if (drop()) return;
    if (res.ok || res.body.decision) setRun(res.body); else { setRun(null); setFail(`Could not evaluate (${res.body.error || res.status}).`); }
  }, [story]);

  useEffect(() => { setRun(null); }, [resetSignal]);
  useEffect(() => { runScenario(id); }, [id, resetSignal, runScenario]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gate">
      <section className="panel" aria-labelledby="sc-h">
        <h2 id="sc-h">Scenarios</h2>
        <div className="seg" role="group" aria-label="Scenario">
          {story.scenarios.map((s) => <button key={s.id} type="button" aria-pressed={s.id === id} onClick={() => { setId(s.id); if (onSelect) onSelect(s.id); }}>{s.title}</button>)}
        </div>
        <p className="lesson" data-testid="lesson">{scenario.lesson}</p>
      </section>
      <section className="panel" aria-labelledby="res-h">
        <h2 id="res-h">Gate result</h2>
        {fail && <p className="field-error" role="alert">{fail}</p>}
        <Verdict run={run} />
        {run && <Hops hops={run.hops} traceId={run.traceId} />}
      </section>
      {prefs && <PreferenceEditor current={prefs} onSaved={(p) => setPrefsState(p)} />}
      <ProtectPanel detected={detected.detectedAgent} detectedRule={detected.detectedRule} onEvaluated={(res) => setDetected({ detectedAgent: res.body.detectedAgent, detectedRule: res.body.botDetection })} />
      <ToolCall tools={story.tools} onResult={(r) => setRun(r)} />
      <ApprovalPanel onChanged={() => {}} refreshSignal={run} />
      <section className="panel" aria-labelledby="prefs-h">
        <h2 id="prefs-h">Scenario preferences (decoded)</h2>
        <p className="tag tag--warn">{story.tokenLabel}</p>
        <Json value={{ preferences: scenario.preferences, tool: scenario.tool, detectedAgent: scenario.detectedAgent }} label="Scenario input" testId="scenario-prefs" />
        <h3>What we know, and how well</h3>
        <ul className="facts" data-testid="facts">
          {story.facts.map((f) => <li key={f.id}><span className={STATUS_CLASS[f.status] || "tag"}>{f.status}</span> {visible(f.text)} <span className="muted">({visible(f.source)})</span></li>)}
        </ul>
      </section>
    </div>
  );
}
