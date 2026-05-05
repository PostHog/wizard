---
title: Anti-patterns and failure modes
description: Concrete examples of changes that violate the design discipline, what goes wrong downstream, and what to do instead. Read when evaluating whether a proposed change fits the architecture.
---

# Anti-patterns

Each section describes a pattern that looks reasonable in isolation but degrades the system over time. The failure modes are drawn from real production codebases — they're not hypothetical.

## Inlining product logic into the runner

**The pattern:** A new feature needs something after the agent completes — committing an event plan to an API, polling for data ingestion, creating a dashboard server-side. The fastest path is adding the logic directly to the runner function, after the agent run and before the outro.

**What happens next:** The runner grows. It now knows about your product concept (event plans, dashboards, data ingestion). Another feature does the same thing. The runner now knows about two product concepts. A third. The function passes 500 lines, then 1000. Each product concern interacts with error handling — a network failure during dashboard creation needs different recovery than a failure during event plan commit. The error handling branches multiply. Token refresh logic appears (long runs outlive the OAuth expiry). Soft-error vs. hard-error classification appears (did the agent do enough work that we should continue despite the failure?). Each of these is reasonable in isolation. Together they produce a function that no one can hold in their head.

**The cost:** Every future change to any product concern risks breaking every other product concern. A contributor who wants to modify the event plan step must understand the dashboard step, the data ingestion step, the error classification, and the token refresh timing. The required knowledge for a local change has expanded to the full function.

**What to do instead:** Use `WorkflowRun.postRun` for post-agent work. If the post-agent step is complex enough to need its own error handling, extract it to a module and call it from postRun. If multiple workflows need the same post-agent step, make it a shared function that postRun calls — not shared code in the runner. The runner stays generic; the product knowledge stays in workflow configuration.

---

## Growing commandments into tutorials

**The pattern:** The agent keeps making the same mistake — using the wrong env var name, running a project-wide lint instead of scoping to edited files, installing non-PostHog packages. The fix seems obvious: add more detail to the commandments so the agent knows exactly what to do.

**What happens next:** Each commandment grows from one sentence to a paragraph. Paragraphs acquire bullet lists. Bullet lists acquire sub-bullets with examples. The commandments file grows from 500 tokens to 5,000. But commandments are appended to the system prompt on every turn — they're part of the cached prefix, but they still consume context window. On a long run with many tool calls, the bloated commandments push useful context (the user's actual code, the skill content, the conversation history) out of the window. The agent starts making mistakes because it can't see its own prior work, not because it lacks instructions.

**The cost:** Context window is finite. Every token of commandment is a token not available for the agent's actual task. And long commandments create a second problem: the agent satisfices across conflicting instructions rather than following any single instruction precisely. A 20-bullet commandment list gets partially followed; a 5-line commandment list gets followed completely.

**What to do instead:** Keep commandments to one sentence per rule — the invariant, not the explanation. Move the explanation, examples, edge cases, and rationale to a skill reference file. The agent loads reference files on demand (progressive disclosure), so the detailed guidance is available when needed without consuming context window on every turn. The commandment points at the reference: "API key conventions — see `wizard-prompt-supplement/references/api-keys-and-env.md`."

---

## Building recovery instead of prevention

**The pattern:** The agent occasionally runs a destructive command, writes a hardcoded secret, or gets stuck in a retry loop. The response is to build infrastructure that detects the problem and recovers: a circuit breaker that kills the run after N consecutive denied commands, a checkpoint system that saves state so the run can resume, a self-heal module that detects and patches agent mistakes.

**What happens next:** The recovery infrastructure works — sort of. The circuit breaker fires after 47 denied commands instead of preventing the first one. The checkpoint system adds 300 lines of state serialization. The self-heal module adds 250 lines of heuristic pattern matching. Each module is tested independently but their interactions are not — a checkpoint saved during a self-heal cycle can restore to a state that triggers the circuit breaker. The recovery code becomes its own source of bugs, and the bugs are harder to diagnose because they involve interactions between three systems that were each designed in isolation.

**The cost:** Recovery is O(n) in the number of failure modes. Each new failure mode needs new recovery code. Prevention is O(1) — a YARA rule, a canUseTool entry, or a skill content improvement addresses the root cause once. The codebase grows linearly with recovery and stays constant with prevention.

**What to do instead:** For each failure mode, ask: can I prevent this at the boundary? A command that should never run → add it to the canUseTool deny list. A pattern that should never appear in written code → add a YARA rule. A mistake the agent keeps making → improve the skill content or add a one-line commandment. Reserve recovery infrastructure for truly unpredictable failures (network outages, API rate limits) — not for agent behavior that can be shaped by better boundaries.

---

## Imperative UI navigation

**The pattern:** A screen needs to appear conditionally — only when the agent encounters a specific error, or only when a feature flag is enabled. The fastest path is adding a navigation call: `if (condition) goToScreen('error')`.

**What happens next:** The navigation call works for this case. Another conditional screen needs the same treatment. A third. Now the flow has three imperative jumps that interact with the router's predicate-based resolution. The router says the active screen should be X (based on session state), but an imperative jump sent the user to Y. The session state says the user is on X. The screen shows Y. A store setter fires, the router re-resolves, and the user is yanked from Y back to X mid-interaction. The fix is another imperative jump to keep the user on Y. The fix for the fix is a flag that suppresses the router. The router is now partially bypassed.

**The cost:** The system has two navigation mechanisms that disagree. Every future screen change must account for both the predicate-based flow and the imperative jumps. Bugs in this regime are non-local — the cause is a state mutation in the runner, the symptom is a screen flicker in the TUI, and the "fix" that someone applies (another imperative jump) makes the problem worse.

**What to do instead:** Add a field to `WizardSession` that represents the condition. Add a `show` or `isComplete` predicate on the workflow step that reads the field. The router derives the correct screen automatically. If the condition is an overlay (error modal, conflict resolution), use `store.pushOverlay()` — overlays stack above the flow and pop when dismissed, without disrupting the flow cursor.

---

## Bundling knowledge that changes at a different rate

**The pattern:** Integration knowledge (how to set up PostHog in a Next.js App Router project) is useful and well-written. The simplest delivery mechanism is to bundle it in the wizard's npm package — ship the skill files alongside the code.

**What happens next:** It works fine for a while. Then the docs team updates the Next.js integration guide. The skill content is now out of date. But the skill is bundled — updating it requires a wizard release. The wizard release has its own PR cycle, CI, review, publish. The docs update ships in hours; the wizard update ships in days. The gap widens as the product surface grows — more frameworks, more features, more docs updates, each waiting for a wizard release to propagate.

**The cost:** Knowledge delivery is gated by code deployment. Teams that own the knowledge (docs, frameworks, product) can't ship updates without coordinating with the team that owns the deployment (wizard infrastructure). This is a coordination cost that scales linearly with the number of knowledge domains.

**What to do instead:** Deliver knowledge through a decoupled channel. The wizard fetches skill packages at runtime from a source that the knowledge owners can update independently. Context-mill publishes skills as GitHub release assets — the docs team can update a skill without touching the wizard repo. The wizard's runtime fetch adds a network dependency, but the tradeoff is correct: the network cost is paid once per run, the coordination cost of bundling is paid on every update across every domain.

**When bundling is fine:** If the knowledge rarely changes and the domain count is small, bundling avoids the complexity of runtime fetch. The decision depends on the rate of change, not on a universal preference.

---

## Shared mutable state between workflows

**The pattern:** Two workflows need the same information — the detected framework, the user's credentials, a feature discovery result. The fastest path is having both workflows read and write the same session fields, relying on execution order to ensure the first workflow populates what the second needs.

**What happens next:** The dependency is implicit. A refactor changes the execution order. The second workflow reads a field the first workflow hasn't populated yet. The field is null. The second workflow fails with a cryptic error. Or worse: it succeeds with default values that produce a subtly wrong integration. The bug is invisible in tests because the test setup populates the field explicitly.

**The cost:** Implicit ordering dependencies between workflows make the system fragile to refactoring. The dependency graph exists in the developer's head, not in the code.

**What to do instead:** Use the `requires` field on `WorkflowConfig` to make workflow dependencies explicit. For shared data, use `frameworkContext` with documented keys — the `setFrameworkContext` setter ensures `emitChange()` fires and downstream predicates re-evaluate. If two workflows need the same detection result, factor the detection into a shared module that both workflows' `onReady` hooks call, rather than relying on one workflow to populate what another reads.

