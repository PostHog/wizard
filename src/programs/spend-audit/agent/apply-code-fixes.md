---
type: apply-code-fixes
flow: spend-audit
label: Prepare the pull request
optional: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [spend-audit-findings, spend-audit-code-fixes]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash, check_env_keys, set_env_values]
disallowedTools: [enqueue_task]
dependsOn: [measure-volumes]
---

## Goal

Apply the code-side fixes the audit tasks found. Read every `audit-*` handoff
and take only the findings whose `kind` is `saving` and whose `fixed_in` is
`pr`. An `unpriced` finding is never a code edit; the report lists it in the
notebook for the user. For each saving make the smallest edit that implements
its `code_change` where the finding points, following the code-fixes skill for
the SDK-specific shape. Touch nothing else: no reformatting, no unrelated
cleanup, no removal of capture calls or flags.

When the project defines a typecheck, lint or build script, run it on the files
you changed and fix what your edits broke. When a fix cannot be applied safely
(the pattern is not where the finding said, or the change would alter behavior
the finding did not account for), leave the code alone and say so.

You do not write the pull request body. The report task does, from your
handoff, so it has to know exactly what changed and why.

## How you know you succeeded

Your handoff lists each finding id you applied with the files and the change,
each finding you skipped with the reason, and the verification you ran. The
diff holds only those edits.
