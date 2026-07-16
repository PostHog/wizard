# 🔍 QA Team Review Report

| Key                 | Value                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Branch**          | `posthog-code/stream-event-plan-headless`                                                                             |
| **Base**            | `main`                                                                                                                |
| **Files changed**   | 8                                                                                                                     |
| **Agents deployed** | 🔒 security, 🔄 reliability, ⚡ performance, 🎨 frontend, 🔗 compatibility, ✏️ copy, 🧑‍💻 generalist-a, 🕵️ generalist-b |
| **Date**            | 2026-07-14                                                                                                            |

---

## 📋 Summary

- Moves `.posthog-events.json` watching from the TUI into shared task-stream
  machinery.
- Streams normalized event plans during headless/cloud runs and retains captured
  plans after deletion.
- Adds coverage for normalization, file deletion, disabled delivery, and
  terminal payloads.
- Reviewers found lifecycle, stale-artifact, and input-bounding risks in the
  shared watcher.

### Key findings

- 🟡 **High-confidence convergence:** a plan written immediately before
  completion can be missed by the terminal push.
- 🟡 **High-confidence convergence:** every program can ingest a stale plan left
  by an earlier or unrelated run.
- 🟡 Malformed or oversized plan files are synchronously parsed without runtime
  bounds.
- 🟢 Internal `enabled: false` documentation still claims `attach()` is a
  complete no-op.

---

## 🏁 Verdict

> 💬 **APPROVE WITH NITS**

Overall risk is **MEDIUM** under the QA scoring rules because multiple
independent reviewers found medium-severity issues. The two convergent
correctness findings should be resolved before relying on terminal event-plan
delivery in production.

---

## 👥 Agent summaries

| Agent            | Risk      | Summary                                                                                     |
| ---------------- | --------- | ------------------------------------------------------------------------------------------- |
| 🔒 security      | 🟡 MEDIUM | Stale repository-controlled plans and unbounded fields cross an authenticated API boundary. |
| 🔄 reliability   | 🟡 MEDIUM | Shutdown can stop observation before a late plan write is captured.                         |
| ⚡ performance   | 🟡 MEDIUM | Synchronous unbounded reads and polling broaden resource costs across programs.             |
| 🎨 frontend      | 🟡 MEDIUM | Global watching can show stale plans, while terminal timing can leave the UI empty.         |
| 🔗 compatibility | 🟡 MEDIUM | Payload shape is compatible, but late writes can silently disappear from the final update.  |
| ✏️ copy          | 🟢 LOW    | One internal behavior comment and test name are now misleading.                             |
| 🧑‍💻 generalist-a  | 🟡 MEDIUM | Reproduced the final-read race and flagged stale plans from unrelated runs.                 |
| 🕵️ generalist-b  | 🟡 MEDIUM | Confirmed stale-plan, unbounded-input, and terminal-race breakability.                      |

**Note:** ✏️ copy findings are non-blocking nits. 🧑‍💻 generalist-a and 🕵️
generalist-b are independent generalist reviewers used for convergence
validation.

---

## 📝 Findings

| #   | Status  | Priority  | Finding                                  | Location                                       | Agents                                                           | Reasoning                                                                                                          | Suggested fix                                                                                                   |
| --- | ------- | --------- | ---------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 1   | ⬜ Open | 🟡 Medium | Final push can miss a late plan write    | `src/lib/task-stream/task-stream-push.ts:162`  | reliability, frontend, compatibility, generalist-a, generalist-b | Shutdown stops the watcher before an authoritative final read; retry and polling delays can outlive the run.       | Add `EventPlanWatcher.refresh()` and call it before detaching and flushing; test immediate write then shutdown. |
| 2   | ⬜ Open | 🟡 Medium | Stale plans leak into unrelated runs     | `src/lib/task-stream/task-stream-push.ts:129`  | security, frontend, performance, generalist-a, generalist-b      | Every task stream reads pre-existing artifacts, so interrupted runs or repository files can be misattributed.      | Scope watching through program configuration and ignore/remove files that predate the current qualifying run.   |
| 3   | ⬜ Open | 🟡 Medium | Plan input is unbounded and unvalidated  | `src/lib/task-stream/event-plan-watcher.ts:20` | security, performance, generalist-b                              | Type casts provide no runtime safety; large or malformed values can block the event loop or cause rejected pushes. | Enforce regular-file and size limits, string validation, event-count caps, and bounded field lengths.           |
| 4   | ⬜ Open | 🟡 Medium | Watch events amplify synchronous parsing | `src/lib/file-watcher.ts:46`                   | performance                                                      | Filesystems may emit duplicate events, and every forced read synchronously reparses the entire file.               | Debounce watch events, preserve deduplication, and consider asynchronous bounded reads.                         |
| 5   | ⬜ Open | 🟢 Low    | Disabled-mode contract is outdated       | `src/lib/task-stream/task-stream-push.ts:10`   | copy                                                             | Comments and a test name say `attach()` is a no-op even though local event-plan watching now starts.               | Clarify that only destination subscription/delivery is disabled; local artifact watching remains active.        |
