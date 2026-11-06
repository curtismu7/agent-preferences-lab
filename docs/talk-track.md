# Talk track

<!-- Generated from server/src/preferencesData.js by `npm run talk-track`. Do not edit by hand. -->

## Say first

Everything here is simulated: the preferences, the Protect signal and the tool boundary are mock, mirroring what we enforced live in AI-DEMO2 on 2026-11-06.

## The preference

The user — not the admin, not the agent — sets what their agent may do: allowed action tiers, an optional spend cap, and what happens when Protect detects an AI agent. The preference lives on the user as a JSON attribute.

## The tool boundary

Every agent-originated tool call passes the gate. It checks the tier against the allowed list, the amount against the cap, and the session-start detection signal against the unknown-agent policy. Permit, human approval, or deny.

## Human approval

A blocked-but-approvable call is answered 428 with a task id. The human approves or denies in the approval panel; an approved task lets the retried call proceed. Deny ends it.

## Protect agent detection

With agent identification on, Protect's bot detection names the agent type — rules 660 to 674, like "AI agent - Muse detected". That is the session-start signal here. Whether every call needs its own evaluation is still open; once per session shipped first.

## When the preference cannot be read

The gate fails closed: no allowed actions, unknown agents go to a human. An outage never silently grants an agent more freedom.

## What we do not claim

The mock values are invented; only the shape and the decision contract follow what we enforced live. Whether Protect should evaluate per call is UNVERIFIED until tested.

## Close

Reset clears your workspace: preferences, detections, challenges and runs. Nothing was sent anywhere.

## The five scenarios

1. **Permitted: read tool, read allowed.** The tier is in the allowed list, no cap applies to reads, and nothing detected an agent: permit.
2. **HITL: write tool, user allows read only.** The tool needs the write tier; the user only allowed read. The call is not lost — it becomes a human-approval task (HTTP 428).
3. **HITL: amount over the spend cap.** The tier is allowed but the amount (750) exceeds the 500 cap. The cap reason is what the human sees.
4. **HITL: Protect detects an AI agent.** Mock Protect named an AI agent at session start and the default policy is hitl: even an allowed read goes to a human first.
5. **Denied: Protect detection with a deny policy.** The user chose to deny detected agents outright: HTTP 403, no approval path. The strictest preference wins.
