# Local execution-policy diagnosis — 2026-10-08

The user asked why local Web startup was rejected and whether it can be fixed.
The observed failure is a **tool execution-policy rejection before process
creation**. Its exact rule and producer remain unidentified. Earlier references
to an "automatic review rejection" were an inference, not a verified cause.

## Verified evidence

- The user already authorized local Web startup and the specified Chromium.
  Repeated conversational authorization is not the missing prerequisite.
- User configuration sets `sandbox_mode = "danger-full-access"` and trusts this
  project. Current-task runtime logs independently report `DangerFullAccess` and
  `Never`, so this is not merely an unread configuration-file setting.
- The user rule file contains **40 prefix rules, all `allow`**; it contains no
  `prompt` or `forbidden` decision. Codex CLI **0.153.4** performed a read-only rule
  check of the original command:

  ```text
  codex execpolicy check --pretty --rules <user-rules>/default.rules -- corepack pnpm --filter web exec next start --hostname 127.0.0.1 -p 3107
  { "matchedRules": [] }
  ```

  This checks that local rule file; it does not prove that every execution layer
  permits the command and does not run the server.
- No project or ancestor `.codex/config.toml`, local managed configuration or
  requirements file was found at the checked documented locations. User config
  contains no custom auto-review policy or hooks. This does not establish the
  absence of platform-managed policy.
- Available current-task and desktop log checks did not establish a rejecting
  rule, reviewer rationale or policy source. The tool's reported reason remains
  only `blocked by policy`.
- The earlier specified-Chromium launch succeeded. Application tests remain
  **16 discovered / 0 executed**; neither this diagnostic nor that launch counts
  as application acceptance.

## Interpretation and supported next steps

Official [Rules](https://learn.chatgpt.com/docs/agent-configuration/rules) documents
the rule checker and the precedence `forbidden > prompt > allow`.
[Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review) states that
ordinary automatic approval review applies to interactive approval modes, not
`approval_policy = "never"`. Therefore the current evidence does not justify
attributing this failure to standard local auto-review or a user deny rule.

Inspect an actual client rejection item for its detailed reason, if available.
A normal client restart/reload can check for stale session state but is not a
verified fix. If the original action remains rejected, use this minimal report
with the client's feedback/support workflow to obtain the missing provenance.
The official one-action denial override applies only when a genuine Auto-review
denial is present in a supported surface; it is not assumed to exist here.

No local policy was weakened, no allow rule was added, and no alternative launcher
or server-start retry was used in this diagnosis. No credentials, raw command
history, private conversation data or full configuration were copied into this
record. Temporary work remains in `wkkk/chat-reader-policy-diagnosis-20261008`.
There was no application change, commit, CI, deployment or production access.

## Revalidation and goal checkpoint

The third resumed goal turn observed no listeners on the four prepared fixture
ports (3107, 8008, 45438 and 8328). There was no running service to wait on or
accepted policy change to justify another startup attempt. The rule/config/log
diagnosis is exhausted at the available evidence boundary. The same unresolved
blocker has now recurred across three resumed turns, so the goal is **blocked,
not complete**. Preserve all work and the 16 unexecuted cases for resumption.

## Follow-up after the user-reported client restart

The user reported restarting Codex. The goal resumed, starting a fresh blocked
audit. One retry of the original Web command, with the existing test-only local
environment, returned the same `CreateProcess ... rejected: blocked by policy`
before creating PowerShell. No session or listener was created. The supporting
API/worker/database fixture was not launched.

At 07:43 UTC the current runtime logs still reported `Never` / `DangerFullAccess`.
A bounded current-task log check and the three most recently updated desktop logs
did not reveal a rule or reviewer denial reason. All four fixture ports remained
idle. A normal client restart has now been tried and did **not** resolve the
observed failure; do not repeatedly recommend it as a solution. The user was asked
whether the client exposes a more detailed rejection item. No policy was changed,
no alternative launch was attempted, and application cases remain unexecuted.
