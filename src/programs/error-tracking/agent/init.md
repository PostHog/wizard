---
type: init
flow: error-tracking
label: Set up PostHog initialization
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [integration-v2-init, posthog-best-practices]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash, check_env_keys, set_env_values]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Make sure PostHog is initialized. If the project already has a working
`posthog.init(...)` (or the framework's equivalent) with its env keys wired,
leave it alone and say so in your handoff. If it doesn't, create it following
your skill — it owns the how: the framework's init point, the env-var wiring
through the wizard tools, and `.env.example`.

You exist in this flow because the user asked for error tracking on a repo
whose PostHog init is missing or unproven. Initialize the SDK so exceptions can
flow and stop — no instrumentation, no extras. Don't set up exception capture
either way; the capture-exceptions task after you owns that.

## An existing init still needs its variable defined

"Already initialised" is a property of the pair, not of the call. An init point
that reads `process.env.SOMETHING` only works when `SOMETHING` is defined in the
env file the project loads. A repo can carry an init that has never once run:
the call is there, the variable it names is nowhere, and the client is built
from an empty string.

So before you leave an existing init alone, call `check_env_keys` on that env
file and look for the exact name the init reads. It returns names, never values.

- **Present** — the pair is complete. Leave it alone and say so.
- **Absent** — the init is not wired yet, whoever wrote it. Write that variable
  with `set_env_values` under the name the code already reads, and document it
  in `.env.example`. Do not rename the code to match a name you would rather
  have written; the code is the half that already exists.

An empty key is the quiet failure here. A client constructed from `''` throws
nothing and logs nothing. The build is clean, the app starts, every capture call
returns — and no event ever arrives.

## Make the environment actually reachable

Writing the keys to `.env` is only half the job — something has to load that
file at runtime, or the app throws on boot and captures nothing.

Most frameworks do it for you: Next, Nuxt, Astro and SvelteKit auto-load `.env`,
and Vite auto-loads it for client code. Nothing to do there.

A plain Node backend does not — Express, Fastify, Hono, Koa, a raw `node:http`
server — and neither does a bare Rollup or webpack config. When the project
already loads `.env` there (a `dotenv` import, an env-file flag in its scripts),
leave it alone.

When nothing loads it, do not wire a loader. Don't install a package for it and
don't edit `start` or `dev`. Every way in is a guess about where the app runs: a
hard `--env-file=.env` stops the app wherever the gitignored file is missing,
`--env-file-if-exists` needs Node 22.9, and putting the variables in front of
the command commits the key. Name it in your handoff as a manual follow-up
instead, with the variable names and the user's two options: load `.env` with
`dotenv`, or set the variables in the app's environment. Say that until then,
the guard stops the app at boot in development with
`POSTHOG_… variable required by PostHog is missing or un-configured`. That loud
failure is the guard doing its job.

Some platforms have no environment to read at all, and there the answer is not
a loader. Angular on the stock `@angular/build` builder is the common one:
nothing populates `process.env`, `import.meta.env`, or the project's own
`src/environments/.env.ts` with your keys.

The trap is that each of those *looks* like a mechanism. `import.meta.env` and
the `NG_APP_` prefix only exist with `@ngx-env/builder` installed, and a
generated `.env.ts` usually carries one unrelated key such as
`npm_package_version` and nothing else. Read from either and your key is
`undefined`: in development the guard throws while the module evaluates and the
app renders a blank page, and in a production build the guard returns quietly,
so the app looks fine while PostHog never initialises at all.

So do not wire a lookup unless you have opened the thing it reads from and seen
your key defined there. When nothing populates it, write the real public project
token as a literal in the committed `src/environments/*` files. This is the
skill's "no valid environment to read from" case, and the public token is
publishable — it ships inside the browser bundle either way.

## The init has to type-check

You cannot run the build either. So in a project the compiler checks —
TypeScript, or JavaScript under `checkJs` — the init has to compile by
construction. `process.env.ANYTHING` is `string | undefined`, and the SDK
constructor wants a `string`.

Pass the variable that you checked. `if (!key) { … } else { new PostHog(key, …) }`
narrows `key` to `string`. A check on a different variable does not: store the
missing name in `missing`, test `missing`, then pass `key`, and the compiler
still sees `string | undefined`. The build then stops with "Argument of type
'string | undefined' is not assignable to parameter of type 'string'", emits
no bundle, and uploads no source maps. When the existing code already passes
`process.env.KEY ?? ''` or `process.env.KEY!`, keep that part as it is.

## How you know you succeeded

An init point exists with the PostHog env keys present — whether it already
did or you just created it — keys in the env file and confirmed there with
`check_env_keys`, never hardcoded. On a platform that does not auto-load
`.env` and has no loader, your handoff names it as a manual follow-up; on a platform with no environment at all, the
token is a literal rather than a lookup into something that never defines it.
In a type-checked project, the value you pass to the SDK is narrowed to a
`string`.
Your handoff names the files involved, how the client is constructed, and how
`.env` reaches it, so the capture-exceptions task can find the init options
without re-discovering them.
