---
title: Maintaining the wizard's skills corpus
description: How to keep the skills under .claude/skills/ accurate and useful over time. Read when reviewing, updating, or auditing the skill set — or when feedback from a real task surfaces drift.
---

# Maintaining the wizard's skills corpus

The wizard ships four skills under `.claude/skills/`: `wizard-development`, `adding-framework-support`, `adding-skill-program`, `ink-tui`. They guide agents and human contributors through the design discipline (the meta-skill) and three procedural domains. Like any documentation, they go stale silently. This reference codifies what we've learned about keeping them load-bearing.

## Why skills go stale

Skills go stale when the codebase changes faster than the skill's prose. The most common drift sources, in order of severity:

1. **A new factory or abstraction lands.** When a clean factory call exists for the common case (like `createSkillProgram` for skill programs, or `runAgentWizard` for framework integrations), the skill should lead with it. Skills written before the factory still teach the primitives — and following them produces more invasive changes than needed. This is the highest-impact drift: contributors do extra work the architecture doesn't ask for.

2. **A refactor changes the wiring.** When wiring becomes derived (e.g. bin.ts deriving subcommands from `PROGRAM_REGISTRY` instead of hand-wiring each one), skills written before the refactor still teach the manual path. Contributors edit files that no longer need editing.

3. **Path references rot.** Specific file paths (`src/lib/programs/revenue-analytics.ts`) become directories or move. Directory paths (`src/lib/programs/revenue-analytics/`) survive better. Pinning to a specific file inside a directory ages worst — the file gets renamed during refactors and the skill's pointer rots first.

4. **Code snippets duplicate canonical examples.** When the skill embeds code that mirrors a pattern in the codebase, the two copies drift apart. Six months later the canonical example has new fields the snippet lacks; the snippet has parameters the canonical example removed.

5. **Prose contradicts a code comment.** The header comment in `program-registry.ts` says "screen-sequences.ts, store.ts, and bin.ts all derive their wiring from this array — no need to touch those files." If the skill still walks through editing those files, the skill is the wrong one.

## What to check when reviewing a skill

Run this checklist against the skill:

- **Path validity.** Every file path in the skill — open it. If it's a directory now, fix the reference or drop the path entirely. If the file moved, find its replacement or remove the pointer.
- **Factory check.** Search the codebase for any function whose name suggests it's the entry point for what the skill teaches (e.g. `create*Program`, `add*Framework`, `register*`). If one exists and the skill doesn't mention it, the skill is leading with the wrong abstraction level.
- **Auto-derived wiring.** Search for `getSubcommandPrograms`, `PROGRAM_REGISTRY`, `FLOWS`, or similar registry-derived patterns. If the skill teaches manual edits to anything those derive, the skill is teaching dead work.
- **Code snippet drift.** Every code snippet — does an equivalent canonical example exist in the codebase? If yes, replace the snippet with a directory pointer. The codebase is the source of truth; skill snippets are a copy.
- **Code comment vs skill prose.** The most authoritative documentation is the comment at the top of the file the skill describes. If the skill and the comment disagree, the comment wins (it's adjacent to the code that enforces it).
- **API surface check.** For each interface or type the skill names — open the source file. Does the skill list every required field? Every optional field worth mentioning? Are any deprecated fields still in the skill? Are any new fields missing?
- **Test as truth.** Tests in `__tests__/` adjacent to the abstraction lock down its contract. If a skill claims behavior that no test enforces, that claim is more likely to drift. Prefer pointing at tests for invariants.

## When to trigger a review

- **While you're shipping a major architectural change.** This is the primary trigger. When you introduce a new factory, derive wiring that used to be manual, deprecate a pattern, rename a load-bearing file, or change the shape of a typed boundary, audit every skill that names that abstraction *as part of the same change*. Updating the skill alongside the refactor is cheap; updating it months later, after a contributor has already followed the stale guidance, is expensive. The skills are downstream of the architecture — keep them in sync at the source.
- **After a real task validation.** The most reliable retroactive staleness signal is feedback from someone (or some agent) who tried to use the skill to do real work. If they had to read source code to figure out something the skill should have told them, that's a gap. If they made edits the skill suggested but the system didn't need, that's drift. Use these reports to catch what slipped past the at-the-source audit.
- **When the skill's `version` is unchanged but the codebase has shipped multiple releases.** A skill at `version: "1.0"` six months and ten releases later is more likely to have drifted than not. Use git log on the source files the skill describes — if there's significant churn, audit.
- **Before a season of contribution.** If you're inviting external contributors (PostHog hackday, an open-source push), audit the skills first. The cost of a stale skill multiplies by the number of people who follow it.

## Patterns that age well

- **Pointing at directories, not files.** `src/lib/programs/audit/` survives file renames within the directory. `src/lib/programs/audit/index.ts` rots when the file gets restructured.
- **Pointing at canonical examples and letting the reader read.** "The audit program is the cleanest example of this pattern" survives refactors of the audit program as long as audit remains canonical. A 40-line code snippet inside the skill does not.
- **Stating invariants, not implementations.** "The runner is fixed; what varies is the ProgramRun config" is an architectural claim that survives any refactor that doesn't violate it. A code snippet showing the runner's current shape rots on every refactor.
- **Listing what NOT to do.** Anti-patterns are sticky because they describe failure modes that recur. The contents of `ANTI-PATTERNS.md` stay valid even when the positive patterns evolve, because they describe what breaks if the discipline lapses.
- **Decision questions, not decision trees.** "Who changes this next?" is a question that produces fresh answers as the system evolves. A flowchart that bakes in current answers rots when the answers shift.

## Patterns that age poorly

- **Step-by-step procedures with file paths.** Every path is a hostage to refactoring. Step-by-step prose is a hostage to API changes.
- **Code snippets that duplicate canonical examples.** Two copies always drift. Pick one source of truth and point at it.
- **"You'll also need to edit X" instructions.** When wiring becomes derived, these instructions become work the contributor doesn't need to do — but the skill still tells them to do it.
- **Prose that summarizes what a code comment already says.** When the comment changes, the prose doesn't. Reference the comment instead of paraphrasing it.
- **Cross-skill duplication.** When two skills teach the same concept, they drift independently. One skill should own the concept; others should point at it.

## The deletion question

Sometimes the right move is to delete a stale reference file rather than update it. Consider deletion when:

- The reference is more than 50% stale and the SKILL.md can absorb the still-valid parts.
- The reference duplicates information that's better located in the codebase (canonical examples, tests, type definitions).
- Updating would require maintaining a parallel copy of something that already exists in code.

Deletion removes drift surface permanently. Update creates drift surface that needs maintenance forever. When in doubt, prefer deletion plus a directory pointer to update plus an obligation.

## Versioning convention

Skills carry a `version` field in their frontmatter. Bump it as follows:

- **Patch** (1.1.0 → 1.1.1): typo fixes, link updates, minor clarifications. No semantic change.
- **Minor** (1.1 → 1.2): new sections, additional patterns, extension of existing guidance. The previous version is still substantially correct.
- **Major** (1.x → 2.0): substantial rewrite. Following the previous version would produce wrong work. The bump signals "everything you knew about this skill needs re-reading."

When you bump a version, also bump the `version` in any reference file that shipped as part of the change. Version churn is itself a maintenance signal — a skill that's bumped majors three times in a year is probably teaching an abstraction that hasn't stabilized.

## The maintainer's question

When you finish updating a skill, ask: "If a contributor with no prior context follows this exactly, will they produce work the architecture currently asks for?" Not "will they produce something that works" — works is necessary but not sufficient. The skill should produce idiomatic output, not just functional output. If following the skill produces a bin.ts edit that the registry would have done automatically, the skill is asking for work that should be automatic.

The wizard's compactness is a side effect of good design discipline. The skill's accuracy is a side effect of good maintenance discipline. Both decay without active care.


