# Wizard triage: remarks + errors — 2026-07-07

Sources: `wizard remark` events (34 pi + 20 anthropic, prod, basic-integration, last ~4 days),
`$exception` events (`team=docs-and-wizard`, 7d), `wizard: bash denied` / `wizard: yara rule
matched` / `wizard: agent api error` / `wizard: agent aborted` (7d). Remarks only flow from
builds ≥ 2.38.1 (published Jul 6 15:43 PT); earlier pi runs are silent.

Each item names the owning surface per the repo's design discipline: **wizard** (runner,
fence, tools, detection), **context-mill** (skills, prompt notes), **warlock** (YARA rules),
**MCP server** (tool schemas), **platform** (auth/infra).

---

## P0 — losing users or data today

### 1. Auth/OAuth failures are the single biggest error bucket (~900 events, ~600 users / week)

| Exception | Events | Users |
|---|---|---|
| Request failed with status code 401 | 175 | 171 |
| Authorization timed out | 162 | 161 |
| Authentication failed while trying to fetch user data | 148 | 33 |
| Authentication failed | 132 | 85 |
| Request failed with status code 400 | 78 | 78 |
| 403 / access denied project data / OAuth access_denied / invalid_grant | 89 | 61 |

This matches the funnel: `started → auth complete` is the biggest drop (467 → 308 on Jul 6).
Mostly platform-side, but the wizard can soften it.

**Fixes:** (wizard) retry-once on token exchange 401/timeout before surfacing; show a
resumable "press enter to reopen browser" instead of dying on `Authorization timed out`;
(platform) check OAuth authorize latency — 161 users/week timing out is not user error.

### 2. Skill install failures — 131 events / 67 users, plus an invisible cohort

`Skill install failed: download-failed` (the wizard-native abort path). Root causes seen in
the field: missing `unzip` on stock Windows, missing `%TEMP%`, and one anthropic remark shows
**`curl ENOENT`** (no curl either). The agent-path variant doesn't except at all — the run
"succeeds" with no skill (confirmed: mcblessing1, balthasarbeyer Jul 6; gpt-5.4 quit in 30s,
sonnet ground through blind). Bash denials show users/agents manually `mkdir -p
~/.claude/skills/...` as a workaround.

**Fixes:** (wizard) **#807 merged, shipped in 2.38.1** (unzip→tar→Expand-Archive fallback +
temp-dir creation + failure telemetry) — expect the Windows-extraction share to decay as npx
caches roll; **PR #809 / issue #808** (fetch + fflate, no subprocess at all) is the remaining
piece — the Jul 7 05:58 `curl ENOENT` remark happened on a post-#807 build, so missing-curl
still fails today; (context-mill) prompt fallback note: if `install_skill` fails, halt with a
clear signal instead of freelancing.

### 3. Editor plugin install failures — ~130 events / ~110 users

`Claude Code plugin install failed: Plugin "posthog" not found` (97 ev / 83 users, both
`claude` and `/opt/homebrew/bin/claude` paths) and `Codex plugin install failed` (33/31).
This is the post-outro MCP screen — the last thing users see, failing at scale.

**Fixes:** (wizard) verify the plugin marketplace name/registry the CLI installs from;
capture stderr detail (Codex failure message is empty); don't show "installed ✓" on nonzero
exit.

---

## P1 — burning agent turns and poisoning the experiment

### 4. `.posthog-events.json` lifecycle confusion — top remark theme (17 of 34 pi remarks)

The skill tells the agent to remove the plan file; pi's fence blocks `rm` (31 denials this
week — the #1 denied command), and the host already deletes it (`pi/index.ts`, #15). Agents
burn turns trying rm → empty-write → agonizing in remarks.

**Fixes:** (context-mill) skill/prompt: "leave `.posthog-events.json`; the host removes it" —
one line kills the whole category; (wizard) alternatively allowlist exactly
`rm ./.posthog-events.json`.

### 5. read-before-write rule on NEW files — 10 of 34 pi remarks

Pi's fence requires read-before-write; `read` on a missing file returns ENOENT and doesn't
count, so creating `instrumentation-client.ts` / `.posthog-events.json` costs a failed call
each time. Also: files created during the run still require a fresh read before later edits.

**Fixes:** (wizard) fence: treat write-to-nonexistent-path as create, no prior read needed;
(context-mill) meanwhile document the exception explicitly in pi runtime notes.

### 6. YARA precision on pi (no LLM triage → hard blocks + retry loops)

| Rule | Action | Harness | Matches | Runs |
|---|---|---|---|---|
| pii_in_capture_call | blocked | pi | 109 | 26 |
| posthog_pii_in_capture_call | reverted | anthropic/legacy | 131 | 129 |
| hardcoded_posthog_host | blocked | pi | 22 | 11 |
| autocapture_disabled | blocked | pi | 6 | 2 |

109 blocks across 26 pi runs = **~4 retries per affected run** — the agent re-attempts a
blocked edit nearly unchanged. Remark-reported false positives: benign `location` property,
auth-success events with minimal payloads, capture edits adjacent to existing `identify()`
PII, **pre-existing violations in the repo blocking their own replacement**, and env-fallback
host literals (`|| 'https://us.i.posthog.com'`).

**Fixes:** (warlock) tune `pii_in_capture_call` (scope match to the added lines, not the
neighborhood; allowlist common non-PII keys), allow host literals in fallback position;
(wizard) tuning-branch `0015fa9` ("never retry a scanner-blocked edit unchanged") addresses
the retry loop — ship it.

### 7. Framework misdetection sends the wrong skill

Field cases: Vite/React SPA detected as `javascript_node` (2 users — kevd1337 paid $8.29 +
a rerun for it), Flutter app detected as Kotlin/Android, static site with no package.json
offered an npm install, `Router mode: unknown` → wrong react-router skill variant installed,
`next: "16.2.2"` internal-version confusion.

**Fixes:** (wizard) detection: check for `vite` in devDependencies before concluding
javascript_node; detect Flutter (`pubspec.yaml`) before android; surface router mode
detection before skill selection; (context-mill) prompt: "verify framework from package.json
before choosing a skill; if the skill contradicts the repo, say so and pick again."

### 8. MCP insight-creation schema rejections (both harnesses, ~7 remarks)

`TrendsQuery.breakdown` rejected, `FunnelsQuery.funnelWindowInterval` rejected — agents build
the final dashboard by trial and error (gpt-5-mini's 400s on Jul 3, still happening Jul 7).

**Fixes:** (MCP server) accept-or-document these fields on the insight-create tool; return
the list of supported fields in the error; (context-mill) include one known-good breakdown
example payload in the skill.

---

## P2 — friction and cost

### 9. Bash fence gaps and false positives

Top denials besides rm-plan-file: `detect_package_manager` typed **as a shell command** (7×
— agents miss that it's an MCP tool), `pnpm -v` (4), `bundle install` (3), `npx expo install`
(3), `npm run check/test/start`, and "dangerous operators" false-positives on lint commands
with parens/globs (`app/(auth)/login/page.tsx`). Windows users' manual skill-dir `mkdir`s
also land here (symptom of #2).

**Fixes:** (wizard) allowlist version checks and the per-ecosystem installers the skills
themselves recommend (`bundle install/add`, `npx expo install`); relax dangerous-operator
match for quoted path args; (context-mill) bold the "detect_package_manager is an MCP tool,
not a command" line.

### 10. Env-file handling (~8 remarks)

`.env.example` unreadable via file tools / must go through `set_env_values` (surprises every
model); wizard-tools path scoping blocks env ops on sibling backend dirs in monorepos;
required non-PostHog env vars (`POSTGRES_URL`, `AUTH_SECRET`) break build verification.

**Fixes:** (wizard) allow plain reads of `.env.example` (it's a template, not a secret);
consider `set_env_values` accepting a target-dir within the workspace; (context-mill) prompt
note: placeholder unrelated env vars before running builds.

### 11. Runtime/sandbox quirks that waste turns

pnpm store-version mismatch (3 remarks), npm `ERR_INVALID_ARG_TYPE`, monorepo root
write-restrictions breaking lockfile updates, network sandbox blocking pip/Google Fonts,
`find` unavailable, MCP socket instability (~10 wasted retry turns in one anthropic run),
`tsc --noEmit` as fallback when `next build` needs network.

**Fixes:** (context-mill) fold the recurring ones into per-model prompt notes — this is
exactly what the tuning branch's `switchboard/prompts/` structure is for; (wizard) retry
transient MCP socket errors internally instead of surfacing to the agent.

### 12. Pi context-cost blowup (single case, structural risk)

kevd1337 run 1: one ~67k-token file read at call 7 → context never compacts (pi declares a
1M window) → 423k tokens/call by the end → **$8.29 for one run** (5× sonnet control).

**Fix:** (wizard) pi middleware: cap single tool-result size (truncate + offer ranged read)
and/or set a realistic contextWindow so compaction triggers.

---

## Watchlist (not actionable yet)

- **Legacy-build noise**: 152 of 178 aborts this week are `harness=None` pre-#793 builds
  (`github connection declined` 31, `no mcp server found` 17) — will fade as npx caches roll.
- **YARA prompt-injection aborts**: 10 sessions/week terminated (`role_hijack` 7). Sample a
  few to confirm they're真 injections, not false aborts.
- **Remark echo**: one Jul 3 remark was the literal instruction text; fixed by 2.38.1's
  parser — watch it stays fixed.
- **Workbench ENOENT spam** (55 events, 1–3 internal users): `.posthog-events.json` /
  settings races in the local workbench — internal only, but muddies the exception tile.

## Suggested sequencing

Already shipped in 2.38.1 (Jul 6): #807 skill-install fallbacks, #805 completion guard,
#806 remark echo fix. Remaining, in order:

1. Merge **#809** (fetch + fflate) — kills the still-live missing-`curl` failure mode.
2. Investigate plugin-marketplace "not found" (#3) — likely one config bug, ~110 users/week.
3. Ship the tuning branch (yara-retry guard + prompt notes cover items 4, 5, 6, 9, 11).
4. Warlock `pii_in_capture_call` precision pass (#6).
5. Detection fixes for Vite/Flutter/router-mode (#7).
6. Auth funnel investigation with platform folks (#1) — biggest absolute number.
