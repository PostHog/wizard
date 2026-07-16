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
- Follow-up fixes resolve the lifecycle, stale-artifact, input-bounding, and
  documentation findings.

### Key findings

- ✅ Terminal shutdown performs a final authoritative plan refresh before
  flushing.
- ✅ Event-plan watching is opt-in through `ProgramConfig` and ignores files
  predating the run.
- ✅ Files, event counts, names, descriptions, and file types are bounded and
  validated.
- ✅ Directory watch events are debounced and disabled-mode documentation
  matches behavior.

---

## 🏁 Verdict

> ✅ **APPROVE**

All actionable findings from the initial **MEDIUM**-risk review are resolved
with regression coverage. The final implementation is scoped to
event-plan-producing programs and guarantees bounded terminal capture.

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

| #   | Status      | Priority  | Finding                                  | Location                                      | Agents                                                           | Resolution                                                                                                  | Validation                                                        |
| --- | ----------- | --------- | ---------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | ✅ Resolved | 🟡 Medium | Final push can miss a late plan write    | `src/lib/task-stream/task-stream-push.ts:164` | reliability, frontend, compatibility, generalist-a, generalist-b | Shutdown refreshes the bounded plan reader before detaching and flushing.                                   | Immediate write → completion → shutdown regression test.          |
| 2   | ✅ Resolved | 🟡 Medium | Stale plans leak into unrelated runs     | `src/lib/programs/program-step.ts:226`        | security, frontend, performance, generalist-a, generalist-b      | Watching is an explicit program capability and files older than the run are ignored.                        | Unconfigured and stale-artifact tests.                            |
| 3   | ✅ Resolved | 🟡 Medium | Plan input is unbounded and unvalidated  | `src/lib/task-stream/event-plan-watcher.ts:8` | security, performance, generalist-b                              | Runtime validation caps file size, event count, name length, and description length; symlinks are rejected. | Invalid-field, oversized-file, count, length, and symlink tests.  |
| 4   | ✅ Resolved | 🟡 Medium | Watch events amplify synchronous parsing | `src/lib/file-watcher.ts:81`                  | performance                                                      | Parent-directory events are coalesced before bounded reads, while polling retains mtime deduplication.      | Atomic rename, recreation, synchronous refresh, and bounds tests. |
| 5   | ✅ Resolved | 🟢 Low    | Disabled-mode contract is outdated       | `src/lib/task-stream/task-stream-push.ts:10`  | copy                                                             | Comments and test names distinguish local watching from destination delivery.                               | Focused task-stream tests.                                        |
