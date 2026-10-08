# Specified Chromium preflight — 2026-10-08

Attribution correction: the later [policy diagnosis](local-execution-policy-diagnosis-2026-10-08.md)
establishes a tool policy rejection but not an automatic-review decision. The
runtime uses full access / Never and no local deny rule matches. The original
failure text and zero executed application cases below remain unchanged.

The user explicitly allowed local Web startup and selected
`C:/Users/86182/Desktop/wkkk/playwright-browsers/chromium-1234/chrome-win64/chrome.exe`
for verification. Testing remains local only. The goal resumed; no completion is
claimed and the blocked-turn audit starts fresh for this resumed run.

## Completed preparation

- The exact executable exists; its file version is **151.0.7922.34**. Playwright
  launched that executable, opened only `about:blank`, read the same runtime version
  and closed its context/browser successfully. This is a browser-runtime check,
  **not an application test**. No production page or account was accessed.
- The current Web build's fallback API rewrite still points to loopback port 8008.
  The four isolated service ports were idle before the attempted startup.
- A task-local configuration imports the repository Playwright configuration and
  pins the requested executable. It removes any channel override and disables
  `webServer`; it can only attach to a separately running local instance. Discovery
  lists the same **16 cases in two files**: eight noise-selection and eight offline
  recovery cases. **Zero application cases executed.**
- A new copy of the existing task supervisor supports explicit
  `--resume --reuse-browser-db`. It retains the original synthetic storage paths,
  requires the named existing database/user and checks its exact 0050 head through
  a read-only transaction before reuse. It neither drops nor recreates that database
  on the reuse path. Python AST syntax passed; runtime reuse has **not executed**.
  The original supervisor and task data remain unchanged.

New temporary configuration, scripts and runtime evidence are in
`wkkk/chat-reader-browser-resume-20261008`. Every invoked command used process-local
TEMP/TMP there; no global environment or default browser configuration changed.
The repository retains [aggregate evidence](specified-chromium-preflight-2026-10-08-evidence/results.json).

## Startup rejection

After the explicit authorization, the existing command was attempted once with
test-only environment values and a loopback API upstream:

```text
corepack pnpm --filter web exec next start --hostname 127.0.0.1 -p 3107
```

The execution tool again rejected it before creating the PowerShell process, with
only `blocked by policy`. No more detailed explanation was provided. The requested
browser itself launches successfully; the blocked action is creating the local Web
service. No alternate server launcher/port, test-managed startup, container or
production substitute was used. Supporting API/worker/PostgreSQL services were not
started after this rejection. User authorization is already explicit and is not the
missing prerequisite.

## Remaining verification

The actual selection recovery, IndexedDB download completion, focus and responsive
layout checks still require a running local Web/API/worker fixture. None is counted
as passed from discovery or from the blank browser page. Earlier 33-case API and
static/build evidence is unchanged; no new full API/PWA gate ran. No commit, CI,
deployment, image build, user-data cleanup or production access occurred.
