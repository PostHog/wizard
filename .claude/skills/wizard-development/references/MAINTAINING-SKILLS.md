---
title: Maintaining the Wizard skills
description: Accuracy, discovery, and verification for contributor guidance.
---

# Maintaining the Wizard skills

[AGENTS.md](../../../../AGENTS.md#skills-available) indexes all five contributor
skills. [CLAUDE.md](../../../../CLAUDE.md) imports AGENTS rather than
maintaining a second instruction set. Keep links and each skill's frontmatter
name aligned with its directory. Reference files should be reachable from their
owning skill.

## Review after a relevant change

When a factory, interface, path, registration mechanism, or runtime boundary
changes, update the skills that describe it in the same change. Feedback from
someone following a skill is also a reason to revisit it.

- Open each linked source and check required fields, signatures, and actual
  consumers.
- Trace registration: native commands, program registry, binding registry, and
  context-mill families have different responsibilities.
- Check sequence-specific behavior. A hook supported by linear execution need
  not run under orchestration.
- Distinguish contribution policy from existing runtime defaults and deployed
  external policy.
- Treat comments and tests as evidence to inspect, not automatic authority.
  Comments can be stale; tests can preserve obsolete behavior. Reconcile them
  with implementation and approved design.
- Prefer canonical examples over copied implementations or inventories. Remove
  obsolete helpers, snippets, and tutorial material instead of maintaining a
  second API manual.

## Verification

Check local links and any embedded commands or snippets. Use existing focused
checks for behavior; avoid tests that assert documentation wording or mirror the
implementation. Run the relevant existing tests when behavior changes. Review
skill prose and external gateway policy separately; local tests do not establish
that either is current.

## Keep the corpus small

Each skill owns a topic; other skills link to it. Put detailed conditional
material in references only when it changes a contributor's decisions. Remove
references that duplicate source or whose useful guidance fits in the
entrypoint. Keep new code comments to one line and link longer explanations.

Bump a skill's `metadata.version` for substantive changes: major for a rewrite
that invalidates the old recipe, minor for new guidance, patch for corrections.
Do not add version fields to reference files solely to mirror the skill version.

Before finishing, check whether a contributor following the guide would edit the
right boundary, use supported APIs, and perform proportionate verification.
