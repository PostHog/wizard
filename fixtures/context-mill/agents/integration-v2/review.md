---
type: review
flow: integration-v2
label: Verify and review the integration
timeoutSeconds: 600
onTimeout: continue
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [posthog-best-practices, integration-v2-build]
allowedTools: [Read, Edit, Glob, Grep, Bash]
disallowedTools: [enqueue_task]
dependsOn: [install, init, identify, mcp-analytics, error-tracking, capture, ai-observability, logs]
---

## Goal

You are the last hands on the code. Work in this order, in one pass, because
verifying and reviewing are the same reading of the same changeset:

1. Install.
2. Review by reading the code, and make your fixes.
3. Run the build.
4. Run typecheck only if the build doesn't include it.
5. Lint the changed files.
6. Run the format check, if the project defines one, on the changed files.
7. If a failure comes from our change, fix it and rerun that check once.

**Install.** The earlier steps edited code but did not install — install now.
Install what the manifest declares plus every package the
upstream handoffs name, in their `packages` field or their text, adding the
named ones by bare name with the project's package manager so it resolves real
versions. The app's existing dependencies
are not yours to touch: never upgrade, downgrade, or re-add a package this
integration did not introduce. Check peer warnings after each install (`pnpm peers check` lists them on pnpm). An optional
peer range the app's version falls short of is not a conflict: keep that version if its
install exits zero and the chosen compile checks pass, and name the mismatch in your
handoff so the report can say so. If an instrumentation package's required peer range
conflicts with a dependency the app already has, install an older
instrumentation version that fits the app's existing versions — find it with
the package manager, stepping down major versions (`pkg@^7`, then `@^6`,
…) for a few attempts rather than looking for documentation of one. A version
fits only if its install command exits zero. A build can't tell you this: it
reads what is already in `node_modules`, while the project's next fresh install
hits the same error. That includes the package manager refusing something the
package brings in under project policy, such as pnpm's ignored build scripts or
trust rules, which is this integration's failure, not the environment's. Never
change the project's allowlists or policy settings to get past it. Undo what
that command changed by removing the package or reinstalling the version it
replaced, then treat the version as one that does not fit. If none
fits, revert that piece of instrumentation, leave the app's dependency alone,
and record the incompatibility so the report can say what was skipped and why.
The exception is an AI Observability wrapper, because those LLM calls can still be
tracked without it. Remove the wrapper and capture its calls manually through the
PostHog server SDK, matching any manual capture the task already wrote and keeping
the distinct ID and trace the wrapper was given, without changing the calls: one
`$ai_generation` per call with `$ai_trace_id`, `$ai_model`, `$ai_provider`, `$ai_input`,
`$ai_output_choices`, `$ai_input_tokens`, `$ai_output_tokens` and `$ai_latency`, and
one `$ai_embedding` per embedding call, without the output fields. Record that manual
capture replaced the wrapper, and why.
A handoff that names a package with a feature or an exact pin (`cargo add
posthog-rs --features mcp`, `@posthog/mcp@latest` saved exact) gets installed that
way. A minimum version is a floor, not the version to install: install the latest
unless a peer conflict forces an older one, and never go below the minimum. Install an exact-pinned package in its own command, so the pin doesn't
spread to packages named without one. In a workspace, install each package into the
workspace package that imports it, not the repository root. A package outside any workspace
takes a directory flag with a relative path, for its install and its checks: `pnpm --dir <path> add`,
`npm --prefix <path> install`, or `yarn --cwd <path> add`. `cd` isn't available. After your last install, run
the project's install once more without changing the lockfile (`pnpm install
--frozen-lockfile` or its equivalent): if it fails on a package this run added, that package
does not fit. Judge a minimum by the version that installs, not the low end of a declared
range: `^1.12.0` that resolves to 1.32.2 meets a 1.26.0 minimum, so install before you decide, and ask
the package manager which version resolved. When a package, or a dependency like
`rmcp`, still resolves below a handoff's minimum because of the project's pin, cap or lockfile, do not raise it: revert that task's
instrumentation and record the pin the user would raise. A toolchain older than
a handoff's minimum surfaces here as a failed install or build in that task's
files; handle it the same way. Build Go with `go build -o /dev/null ./...` so no
binary lands in the project, and never run `cargo fmt`, which reformats the
whole crate. An optional upstream task
(AI Observability, Logs, MCP analytics) may have failed and left partial edits no handoff
describes — install and run the chosen compile checks either way, and let them surface stray
imports; fix or revert them like any other defect. Do not run the test suite; the
runtime does not allow it, and the chosen compile checks are the bar. A bad version only surfaces
here: if the install fails because a declared version does not exist (npm `ETARGET`,
"no matching version", a yanked release), do not guess pins — reinstall the
package by bare name and let the package manager pick, matching the framework
reference example's spec only if that also fails. If the failure is the environment, not the
integration's own change (a pre-existing broken dependency, a package manager that
cannot provision), note it and move on; do not spiral. When you revert a
task's instrumentation because its packages could not be installed, record the
failed command and its error as the reason, not a version minimum: the report
should send the user to the install problem. A build that then fails against an
older copy already in `node_modules` is part of that same install failure. When
you revert a task, delete the files it created rather than leaving them empty, and
remove the parameters, options and refactors it added that nothing uses anymore.

**Review, as a strict reviewer who did none of the writing.** The changeset is
already handed to you: `read_handoffs` returns every upstream task's handoff, and
each one names the files it touched and what it changed in them. That union of
touched files IS the changeset, except lockfiles: they are huge and full of hashes,
so ask the package manager or search for a package's name, and never read one whole.
Read each changeset file once and judge it — after
your own edit you already know its contents, so do not re-read it. Read beyond the
changeset only where a dimension sends you: one neighboring example per pattern you
are checking, and the callers of code that changed. Nothing else — not the SDK's
installed internals, not other tasks' instructions, not a diff of the whole tree;
the handoffs are the signal.
The handoffs also carry what no file shows — env values written through
`set_env_values`, manifest edits. Judge each change against these dimensions, in
order:

1. Minimal — every line earns its place. Delete helpers nothing calls, defensive
   wrapping around code that cannot fail, config for features that were not set up,
   and comments that narrate what a line does or that it was added.
2. Unrelated — the run must not have changed behavior outside the integration.
   Revert reformatting, renames, or edits in code the integration never needed. If a task
   swapped the app's LLM client or SDK, put it back and capture those calls manually.
3. Codebase patterns — for each kind of edit (client construction, how call sites
   reach it, config and env access, imports, naming, comment density), find one
   neighboring example in this project and compare. If a change invented a seam the
   project does not have — a registry, locator, wrapper, or app the codebase never
   uses — replace it with the closest pattern the project actually uses.
4. Example shapes — where the framework reference example shows a shape for init or
   instrumentation, the code should be recognizably that shape adapted to this
   codebase. Codebase idiom beats the example when they conflict; the PostHog
   correctness rules you were given beat both.

You never change what is captured — event names, properties, and where events fire
are a contract the dashboard and report are built on. Refactor how, and kill bad
changes; never alter the what.

Events reaching PostHog in production is the point of this code, so a capture wired
to a place it will never fire, an uninitialized SDK, or a call the runtime silently
drops is squarely yours to catch and fix — it is a code defect. What you cannot do is
confirm delivery: you cannot exercise the app, and you never treat "I could not
verify events arrive" as a finding.

Analytics must also never fail or stall the app's own work, and no build shows you this.
Where the app waits on a PostHog flush or shutdown, its rejection has to be caught and its
client needs a short request timeout with no retries (`requestTimeout` and `fetchRetryCount`
on Node), or a PostHog outage fails a request whose own work succeeded. A client nothing
waits on keeps the SDK's default timeout and retries, and so does one a process only waits on
at exit, which gets a bounded wait such as `posthog.shutdown(3000)` instead. A client that only long-running servers
or workers load needs no flush per capture, so remove it, and it flushes in the app's existing
shutdown path, with a bounded wait. Remove any format check on a PostHog key, such as a URL rule
in an env schema: a blank value fails it and stops the app booting. This changes how events are
sent, not what is captured, so it is yours to fix.

Stay inside verify-and-review. These are not your job:

- The report or the dashboard — other tasks own those; do not write or judge them.
- Product or analytics design — which events are worth tracking, identity strategy,
  framework-version tradeoffs. The changeset is the decision; review whether the code
  implements it correctly, not whether it was the right decision.
- Anything the integration did not touch. Do not widen scope to pre-existing issues.

If you notice something real but out of scope, leave it — a one-line mention in your
handoff, no more. Only flag what you can pin to a specific line and dimension — no
taste-based rewrites, and never expand the integration. For each fix, ask what would
behave differently if it were wrong, and check by reading the callers.

**Verify, once your review fixes are in.** Use as few slow commands as you can. Use
the narrowest package or workspace target that covers the integration's changed code.
Run a root script only when the workspace requires it, filtered to that target where
supported; do not check unrelated packages.
Choose the compile checks once per changed package by inspecting its scripts and
framework behavior. If the build includes typechecking, run the build only. If
build and typecheck/check (such as svelte-check) cover different failures, run the
build, then the typecheck, once each: a passing typecheck does not prove bundling,
asset imports, or framework compilation work. If only one check exists, run it. Skip
equivalent checks, not distinct coverage; do not add alternative checks after a failure.
Then lint only the files this integration changed. Invoke the installed linter
with those paths, replacing broad targets such as `.` while preserving the
project's config and options. Appending paths to a script that still targets
`.` does not scope it. Run the full lint script only when scoped lint is not
supported, once; do not broaden or switch checks after a failure.
Last, run the project's format check if it defines one (a `format` script), and format
only the files this run changed, with the project's formatter or by hand, leaving anything
else it flags alone.

Each check ends in one of three results:

- **Passed:** move on.
- **Failed because of our change** (the error names a file we edited or a package we
  added): batch your fixes, then rerun that check once, along with any check that
  passed earlier if the fixes changed code it covers. If it still fails, report the
  remaining issue and stop that check.
- **Couldn't verify** (a prebuild script fails, a tool crashes, a command hangs or
  times out, or the errors are only in code we didn't touch): record it once and stop
  that check. Don't rerun it, split it into alternative checks, or increase its timeout.

The task has a ten-minute total budget, including install, review, and verification,
and a long command can be stopped early to fit it. A timeout means verification is
incomplete, not that the check passed.

## How you know you succeeded

The project installed and the chosen compile checks, lint and format check passed, or you
recorded exactly what could not be verified; you can name each review dimension
and say it passes; and your fixes are in the files. If the build or lint fails only on pre-existing errors you did not introduce,
that still counts — put a one-line summary in the `conflict` field and the detail in
what you did. Record a timed-out check as verification incomplete in `conflict`,
naming the command; never claim it passed. Reserve a failed status for when your own changes
break the build. Put the number of fixes and the dimension each addressed in your handoff.
