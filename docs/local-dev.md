# Local development targets

Running the wizard against local servers. Four things can independently be
local, and this doc is the catalog of how to control each.

## The four dimensions

| # | What | Local target | How you control it |
|---|---|---|---|
| 1 | The wizard binary | your checkout | how you invoke it — see [Running the wizard](#running-the-wizard) |
| 2 | context-mill (skills) | `http://localhost:8765` | `--local-context-mill` |
| 3 | PostHog MCP server | `http://localhost:8787/mcp` | `--local-mcp` |
| 4 | PostHog app / API | `http://localhost:8010` | `--local-posthog` |

Dimensions 2–4 are genuinely independent. The common case is **not** "everything
local": CI runs local skills against the *production* MCP, and someone testing an
MCP change usually keeps PostHog on prod.

## Flags

All dev/test builds only. A published build rejects them with an explanation —
they point at localhost, which is never right for a real user.

| Flag | Env | Effect |
|---|---|---|
| `--local-dev` | `POSTHOG_WIZARD_LOCAL_DEV` | all three below |
| `--local-context-mill` | `POSTHOG_WIZARD_LOCAL_CONTEXT_MILL` | skills → `:8765` |
| `--local-mcp` | `POSTHOG_WIZARD_LOCAL_MCP` | MCP → `:8787` |
| `--local-posthog` | `POSTHOG_WIZARD_LOCAL_POSTHOG` | PostHog origins → `:8010` |

`--local-posthog` is sugar over `--base-url`. It pins the API host, app host,
OAuth server, and the LLM gateway derived from them.

### Precedence

Most specific wins:

```
MCP_URL / --base-url                                       (explicit URL)
  > --local-mcp / --local-context-mill / --local-posthog   (explicit boolean)
  > --local-dev                                            (umbrella)
  > IS_DEV implicit localhost:8010                         (dev builds, dim. 4 only)
  > production defaults
```

A specific flag beats the umbrella in both directions, so
`--local-dev --no-local-mcp` means "everything local except MCP". Prefer the
additive form though — with three dimensions, "all but one" is just the other
two, and it reads better.

### Recipes

```bash
wizard --local-dev                             # everything local
wizard --local-context-mill                    # local skills, prod MCP + PostHog  ← what CI runs
wizard --local-context-mill --local-posthog    # local skills + PostHog, prod MCP
MCP_URL=http://localhost:9000/mcp wizard       # MCP at a non-standard port
```

## If a local server isn't running

Every `--local-*` flag is preflighted before the run starts. If the server it
asks for isn't listening, the wizard stops with the port, the flag that
requested it, and how to start it:

```
✖ Local services are not running:

  context-mill — nothing listening at http://localhost:8765
    requested by --local-context-mill
    start it with: npm run dev  (in the context-mill repo)

Start the missing services, or drop the flag to use production.
```

This runs **before authentication**, so a missing local PostHog fails here
rather than as "Failed to fetch user data" — and it aborts in CI too, since a
run pointed at a server that isn't there is testing nothing.

Only reachability is checked. Any HTTP reply counts, including 404 and 405 —
the real MCP rejects a bare GET, and that's not a reason to stop.

## `--local-mcp` no longer selects skills

It used to do both — one boolean drove the MCP url *and* the skills base url.
That made "local skills, prod MCP" impossible to say, which is why workbench CI
had to set `MCP_URL=https://mcp.posthog.com/mcp` to undo half of it.

If you have `--local-mcp` in a shell alias or script expecting local skills, add
`--local-context-mill` (or switch to `--local-dev`). The wizard prints a notice
when it sees `--local-mcp` on its own; that notice is temporary and will be
removed once the change has settled.

## `wizard mcp add --local` is a different thing

Not a local dev target. `mcp add --local` writes a **`posthog-local`** server
entry into your editor's MCP config (Cursor, Claude Code, Codex, Zed, VS Code)
pointing at `localhost:8787` — a durable artifact for a *different program* to
use later, sitting alongside your normal `posthog` entry rather than replacing
it. `mcp remove --local` removes only that entry.

It's for developing the **MCP server itself** (in the posthog repo,
`services/mcp`), so you can exercise your build conversationally.

It is command-scoped, available in published builds, and unaffected by the
`--local-*` flags above. There is deliberately **no global `--local`** — reusing
that name would give one flag two unrelated meanings.

## Running the wizard

Dimension 1 isn't a flag; a binary can't flag itself into being a different
binary. It's how you invoke it:

| Mode | Command | Build |
|---|---|---|
| From source | `pnpm try --install-dir=<path>` | dev (`IS_DEV`) |
| Globally linked | `pnpm dev`, then `wizard` | dev, rebuilt on change |
| Workbench harness | `WIZARD_PATH=<repo>` → `$WIZARD_PATH/dist/bin.js` | whatever you last built |
| Published | `npx @posthog/wizard` | production |

To confirm what a run actually used, pass `--debug` and look for the
`[agent-runner] targets` line in `/tmp/posthog-wizard.log` — it prints the build,
skills url, MCP url, and PostHog host together.

## Implementation

`src/lib/local-dev.ts` owns the endpoints and the precedence rule. Everything
downstream reads a resolved value rather than re-deriving "am I local".

One trap worth knowing: the three specific flags are declared **without** a yargs
`default`. They must stay `undefined` when absent so `resolveLocalDev` can tell
"unset, inherit the umbrella" from "explicitly negated". Adding `default: false`
silently breaks both the umbrella and `--no-local-*`.
