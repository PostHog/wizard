---
type: link-releases
flow: error-tracking
label: Link deploys to releases
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Write, Edit, Glob, Grep, Bash, load_skill_menu, install_skill, detect_package_manager]
disallowedTools: [enqueue_task]
dependsOn: [capture-exceptions]
---

## Goal

Link every exception this app sends to the production release it came from.
This platform ships its source as is, so there is nothing to upload. Instead the
production deploy resolves a PostHog release, and the app starts with that
release's ID in `POSTHOG_RELEASE_ID`. Install the skill your task input names
(`install_skill` with the `skillId`) and follow it. It owns the minimum SDK
version, the CI step per provider, and how the ID crosses each deploy boundary.

Your task has three parts, in this order:

1. **SDK version.** Make sure the project resolves at least the SDK version
   that reads `POSTHOG_RELEASE_ID`, per the skill's "Update the SDK" step. An
   older SDK ignores the variable without an error. Refresh the lock for that
   one package with the project's own tool: call `detect_package_manager`
   first. Do not upgrade across a major version when code from before this run
   already calls the SDK; when the `install` handoff says this run added the
   SDK, raise it straight to the minimum. The production runtime
   decides what can install, not the interpreter on this machine: never lower
   the version below the minimum because a local install fails.
2. **Resolve the release in the production deploy.** Trace the deploy path by
   reading the project's own files: CI workflows, Dockerfiles, compose files,
   deploy scripts, service and pool configs. Add the resolve step to the job
   that deploys to production, and to no other job.
3. **Get the ID into the running app.** Pass the ID on at every boundary
   between that step and the process that creates the PostHog client, until
   that process starts with `POSTHOG_RELEASE_ID` in its environment.

## Local development stays as it is

This is a deploy-time change only. Local runs, tests, pull-request builds, and
previews send no release ID, and that is correct. So do not touch run scripts,
dev servers, test config, `.env`, or `.env.example`. Do not ask for a personal
API key, because nothing local uses one. Never run `posthog-cli` yourself: a
resolve creates a real release in the user's project.

Only edit CI and deploy files that already exist. When this project has no
deploy path you can open and follow, make no CI changes. Report the task done
with the SDK update alone, and put the requirement into your handoff as a
manual follow-up.

## The last hop decides it

A release ID that stops one boundary short of the app looks correct in the
diff and does nothing. The resolve step succeeds, the deploy is green, and
every exception still arrives without a release. Each of these boundaries drops
the value unless you pass it on: a `docker build`, a container start, an SSH
session, a service manager's environment, PHP-FPM's `clear_env`, and Laravel's
cached config. So walk the path to its end, and pass the value on the same way
the deploy already passes the app's other runtime variables.

While you are at the start step, check the other names on it too. The app's
PostHog init reads a token and a host, and the start step may predate PostHog.
If it passes the app's variables by hand and leaves those out, add them by the
names the app's source reads, and name any secret the user must create.

## How you know you succeeded

The project resolves an SDK version that reads `POSTHOG_RELEASE_ID`, or your
handoff names the upgrade as a follow-up. The production deploy job resolves
the release before it ships, without failing the deploy when PostHog cannot be
reached. The ID reaches the app process as `POSTHOG_RELEASE_ID`, and no local,
test, or pull-request path changed. Your handoff lists the files you changed,
the SDK version before and after, the deploy path hop by hop, and every secret
and variable the user must create, with its exact name and where it goes.
