# Packages installed wrongly

45 cases. Part of the [edge case catalogue](../edge-cases.md).

## Steering points agents at a missing CLI

**Problem.** Writing a 'use posthog-cli api' block is easy. Checking the CLI is installed and current is a separate step that gets skipped.

**Impact.** Future agents run a command that does not exist or lacks the api subcommand, then guess.

**Rule location.**

- `wizard: src/steps/install-cli-steering/index.ts`
- src/commands/cli/add.ts

**Sources.** [PostHog/wizard#646](https://github.com/PostHog/wizard/pull/646), [PostHog/wizard#687](https://github.com/PostHog/wizard/pull/687)

**Frameworks.** `all`

**Wrong:**

```bash
# ~/.claude/CLAUDE.md gets: 'Use `posthog-cli api` for all PostHog operations'
$ posthog-cli api --agent-help
zsh: command not found: posthog-cli   # or: unrecognized subcommand 'api'
```

**Fixed:**

```bash
npm install --global @posthog/cli@latest   # first; abort steering if it fails
posthog-cli api agents-md install --path ~/.claude/CLAUDE.md
# also Codex (~/.codex/AGENTS.md) and Gemini CLI
```

## Peer dependency conflict hidden behind done

**Problem.** Forcing past ERESOLVE with --legacy-peer-deps makes the install and build pass, so the agent sees nothing left to report.

**Impact.** The wrapper runs against an unsupported SDK major and fails only at runtime.

**Rule location.**

- `wizard: src/lib/agent/runner/sequence/orchestrator/queue-tools.ts` (HANDOFF\_FIELDS.conflict, ~line 409)
- src/lib/agent/runner/sequence/orchestrator/orchestrator-runner.ts (~lines 1142-1226: reads the review task's handoff.conflict, sets the outro message and body)

**Sources.** [PostHog/wizard#1325](https://github.com/PostHog/wizard/issues/1325), [PostHog/wizard#935](https://github.com/PostHog/wizard/pull/935)

**Frameworks.** `javascript_node`

**Wrong:**

```bash
$ npm install @posthog/ai   # ERESOLVE: peer openai ^6, app pins openai ^4.77
$ npm install @posthog/ai --legacy-peer-deps
# task marked done, build passes
```

**Fixed:**

```typescript
// review task's complete_task handoff: one line the wizard surfaces to the user
conflict: "@posthog/ai peers openai ^6, project pins openai ^4"
// outro message: "PostHog set up, with one conflict to review."
// outro body: "⚠ Build conflict: ..."
```

## Bumps the project's Go version for the bridge

**Problem.** Raising the go directive is the quickest fix for 'module requires go >= 1.25.0', and the agent does not treat toolchain changes as the user's decision.

**Impact.** The user's toolchain requirement changes without consent.

**Rule location.** [`context-mill: context/skills/ai-observability/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/1-begin.md) (rule 1)

**Sources.** [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373)

**Frameworks.** `go`

**Wrong:**

```diff
// go.mod
-go 1.22
+go 1.25
```

**Fixed:**

```text
The bridge needs Go 1.25+. An older toolchain fails with
`module requires go >= 1.25.0`.
Say so in the report; do not raise the project's Go version yourself.
```

## Unquoted version specifier in pip install

**Problem.** The agent copies the specifier from requirements.txt into a shell command. The shell reads > as an output redirect and reports no error.

**Impact.** pip installs the latest posthog with no pin and writes its output to a stray file named =3.0.0 in the repo. Nothing reports a failure.

**Rule location.** [`context-mill: context/commandments.yaml#python`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 72: install with `pip install posthog` or `pip install -r requirements.txt`, no unquoted version specifiers like `>=` in shell commands)

**Sources.** [context-mill@9e983de](https://github.com/PostHog/context-mill/commit/9e983de2549c437827e89eef842b9ffc9da1e889), [context-mill@f4be652](https://github.com/PostHog/context-mill/commit/f4be652e)

**Frameworks.** `python`, `django`, `flask`, `fastapi`

**Wrong:**

```shell
pip install posthog>=3.0.0
# bash: output redirected into a file called =3.0.0
```

**Fixed:**

```shell
pip install posthog
# or
pip install -r requirements.txt   # posthog>=3.0.0 lives in the file
# or quote it: pip install 'posthog>=3.0.0'
```

## SDK version typed from memory

**Problem.** Editing the manifest directly feels quicker than running the package manager, and the model trusts the version numbers it remembers. A version that was never published fails only later, at install time, and an old remembered version installs without any warning.

**Impact.** A version that was never published makes the whole install fail with ETARGET, and the build step cannot recover from a bad manifest. Each new guess fails again. A remembered old version pins a stale SDK that still has bugs fixed upstream.

**Rule location.**

- [`context-mill: context/agents/integration-v2/install.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/install.md) (Goal: bare package name, never invent a version)
- [`context-mill: context/skills/integration-v2/install/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/install/description.md) (line 5-6)
- [`context-mill: context/agents/integration-v2/logs.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/logs.md) ('write a version number you invented')
- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) (install and verify)
- [`context-mill: context/skills/audit/references/1-version.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/1-version.md) (sdk-up-to-date, npm view)
- `wizard: src/lib/framework-config.ts:159` (do not manually edit package.json)

**Sources.** [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275), [context-mill@e686888](https://github.com/PostHog/context-mill/commit/e6868883), [context-mill@6015e96](https://github.com/PostHog/context-mill/commit/6015e96e), [PostHog/context-mill#118](https://github.com/PostHog/context-mill/pull/118), [PostHog/wizard#888](https://github.com/PostHog/wizard/issues/888), [PostHog/context-mill#240](https://github.com/PostHog/context-mill/pull/240), [PostHog/context-mill#71](https://github.com/PostHog/context-mill/pull/71), [PostHog/context-mill#213](https://github.com/PostHog/context-mill/pull/213)

**Frameworks.** `all`

**Wrong:**

```text
"dependencies": {
  "posthog-js": "^1.96.0",     // remembered, stale
  "posthog-node": "^5.99.0"    // never published
}
// npm error code ETARGET
// npm error notarget No matching version found for posthog-node@^5.99.0
# pubspec.yaml: posthog_flutter: ^4.0.0   # remembered, not resolved
```

**Fixed:**

```bash
npm install posthog-js posthog-node   # bare names, manager writes real ^x.y.z + lockfile
composer require posthog/posthog-php
bundle add posthog-ruby
flutter pub add posthog_flutter
# ETARGET / yanked release: reinstall by bare name, do not guess pins
npm view posthog-js version           # audit: installed vs latest
```

## Stale CLI version rejects flags it uses

**Problem.** The remembered @posthog/cli version is a real release, so it installs cleanly. The flags in the generated build script come from newer docs, and nothing runs the upload during the integration.

**Impact.** Silent: source maps never upload, yet every e2e assertion passes. Results also differ between runs.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) line 36 ('Never write a dependency version from memory')

**Sources.** [PostHog/context-mill#368](https://github.com/PostHog/context-mill/pull/368)

**Frameworks.** `javascript`, `node`, `nextjs`, `react`, `angular`, `nuxt`, `vite`, `webpack`, `rollup`

**Wrong:**

```json
"devDependencies": { "@posthog/cli": "^0.5.30" },
"scripts": {
  "build": "tsc && posthog-cli --dotenv-file .env sourcemap process --directory ./dist"
}
// error: unexpected argument '--dotenv-file' found (only when the upload runs)
```

**Fixed:**

```bash
npm install --save-dev @posthog/cli@latest
# or pnpm add -D / yarn add -D @posthog/cli@latest
# the manager writes the resolved version into package.json
# variants using the wizard-preinstalled global posthog-cli add no project dependency
```

## SDK version floor older than APIs used

**Problem.** The agent writes code against today's API but keeps the existing constraint, or copies an example's old floor. It never compares the floor with the version that added the method, and the error path rarely runs during verification.

**Impact.** The resolver can pick an old SDK where the method or option is missing or does nothing. The result is a NoMethodError or undefined method on the error path, or a silent no-op. Affected: capture\_exception, enable\_exception\_autocapture, PostHog::captureException, posthog.metrics, URL-trigger replay.

**Rule location.**

- [`context-mill: example-apps/ruby/Gemfile`](https://github.com/PostHog/context-mill/tree/main/example-apps/ruby/Gemfile) (~> 3.3)
- [`context-mill: example-apps/laravel/composer.json`](https://github.com/PostHog/context-mill/blob/main/example-apps/laravel/composer.json) (^4.2)
- [`context-mill: context/agents/integration-v2/install.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/install.md) (known-good floors in the fallback paragraph)
- [`context-mill: context/agents/metrics/verify-sdk.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/metrics/verify-sdk.md) (check 2, 'New enough?')
- [`context-mill: context/skills/posthog-best-practices/references/session-replay.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/session-replay.md) (posthog-js >= 1.171.0)
- [`context-mill: context/skills/audit/references/1-version.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/1-version.md) (major behind = error). Note: example-apps/python, flask, fastapi still say posthog>=3.0.0 (PR #101 closed unmerged)

**Sources.** [PostHog/context-mill#152](https://github.com/PostHog/context-mill/pull/152), [PostHog/context-mill#355](https://github.com/PostHog/context-mill/pull/355), [PostHog/context-mill#342](https://github.com/PostHog/context-mill/pull/342), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#101](https://github.com/PostHog/context-mill/pull/101)

**Frameworks.** `python`, `flask`, `fastapi`, `django`, `ruby`, `ruby-on-rails`, `php`, `laravel`, `javascript_node`, `javascript_web`

**Wrong:**

```python
# requirements.txt
posthog>=3.0.0
posthog = Posthog(token, enable_exception_autocapture=True)  # needs 3.6.0
posthog.capture_exception(e)                                  # needs 3.6.4
# Gemfile: gem 'posthog-ruby', '~> 3.0'   -> capture_exception NoMethodError
# composer.json: "posthog/posthog-php": "^4.0"  -> no PostHog::captureException
```

**Fixed:**

```text
gem 'posthog-ruby', '~> 3.3'     # example-apps/ruby: first 3.x with capture_exception
"posthog/posthog-php": "^4.2"    # example-apps/laravel: first 4.x with PostHog::captureException
# install.md manual-fallback floors: posthog ^7.29.0, posthog-ruby ^3.21.0, posthog-php ^4.12.1
# session-replay.md: URL-match recording errors below posthog-js 1.171.0
# metrics verify-sdk: installed? new enough for posthog.metrics? below it -> upgrade with
# the package manager, at it or above -> leave alone; never invent a version
```

## posthog-js left to a loose peer range

**Problem.** Installing only @posthog/react looks complete, and tracing\_headers is valid in current docs. The peer range (>=1.257.2) lets the lockfile keep an old posthog-js, and old versions ignore unknown options without a warning.

**Impact.** Silent: no tracing headers are attached, so server events never link to the frontend person. tanstack-start resolved posthog-js 1.338.0 through @posthog/react.

**Rule location.**

- [`context-mill: example-apps/react-react-router-7-framework/package.json`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-7-framework/package.json) example-apps/nuxt-3-6/package.json, example-apps/tanstack-start/package.json (explicit posthog-js ^1.406.2)
- [`context-mill: context/commandments.yaml#astro-ssr`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #astro-hybrid (tracing\_headers rule only, no version floor)

**Sources.** [PostHog/context-mill#265](https://github.com/PostHog/context-mill/pull/265), [context-mill@708db41](https://github.com/PostHog/context-mill/commit/708db41c)

**Frameworks.** `react`, `react-router`, `tanstack-router`, `tanstack-start`, `nuxt`, `astro`

**Wrong:**

```typescript
pnpm add @posthog/react   # posthog-js left to the peer range
# lockfile: posthog-js 1.338.0 (transitive via @posthog/react)
posthog.init(token, { tracing_headers: [window.location.hostname] }) // silent no-op
```

**Fixed:**

```typescript
"@posthog/react": "^1.5.2",
"posthog-js": "^1.406.2",   // declared explicitly; option exists from 1.380.0
"posthog-node": "^5.18.0"
posthog.init(token, { api_host: host, tracing_headers: [window.location.hostname] })
```

## Old SDK silently ignores the release ID

**Problem.** The manifest range looks new enough, but the lockfile resolves an older version. SDKs below the floor drop POSTHOG\_RELEASE\_ID without an error.

**Impact.** Silent: no event carries a release.

**Rule location.**

- [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) ('Update the SDK' step and its Tips)
- [`context-mill: context/agents/error-tracking/link-releases.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/link-releases.md) (step 1 'SDK version')

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416), [PostHog/wizard-workbench#4266](https://github.com/PostHog/wizard-workbench/pull/4266)

**Frameworks.** `python`, `ruby`, `rails`, `php`, `laravel`

**Wrong:**

```text
# requirements.txt
posthog>=6.0.0      # lock resolves 6.7.0; 7.59.0 is the first to read POSTHOG_RELEASE_ID
```

**Fixed:**

```bash
# floors: posthog 7.59.0, posthog-ruby 3.25.0, posthog/posthog-php 4.14.0
# read the lockfile, raise the constraint, refresh that one package only
posthog>=7.59.0
uv lock --upgrade-package posthog     # never regenerate the whole lock
```

## Lowers the SDK so a local install passes

**Problem.** When the required SDK floor will not install on the laptop (posthog 7.x needs Python 3.10+), lowering the pin is the obvious fix. The opposite mistake is jumping a major under existing SDK calls.

**Impact.** The release ID is ignored again without an error, or a major upgrade breaks APIs the existing code calls.

**Rule location.**

- [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) ('Update the SDK', Tips)
- [`context-mill: context/agents/error-tracking/link-releases.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/link-releases.md) (step 1)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `python`, `ruby`, `php`

**Wrong:**

```text
posthog<7     # local Python 3.9 cannot install 7.x, so pin lower
# or: composer require posthog/posthog-php:^4.14 in an app that already calls v3
```

**Fixed:**

```text
Keep the minimum (posthog>=7.59.0). The production runtime decides what installs:
Dockerfile base image, CI image, .python-version, Gemfile ruby line, composer php.
Local interpreter too old -> manual follow-up, never lower the version.
Older major + existing SDK calls -> do not upgrade, follow-up.
```

## Old posthog-go never sends symbolication data

**Problem.** The agent wires up symbol upload and assumes the existing go.mod pin is fine. Nothing fails, the data just never matches.

**Impact.** Silent: SDKs before 1.22.0 never emit instruction addresses or $debug\_images, so uploaded symbols are never used.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Go bullet, gotcha 4)

**Sources.** [PostHog/context-mill#299](https://github.com/PostHog/context-mill/pull/299)

**Frameworks.** `go`

**Wrong:**

```go
// go.mod
require github.com/posthog/posthog-go v1.18.0  // older than 1.22.0, left as-is
```

**Fixed:**

```shell
# requires posthog-go 1.22.0+; upgrade in the same step
go get github.com/posthog/posthog-go@latest && go mod tidy
```

## Old @posthog/mcp ignores newer MCP features

**Problem.** An installed @posthog/mcp looks like it is already done, so the agent adds new code or options without checking the version. Older versions reject MCP SDK v2 servers inside instrument(), which swallows the error, and they ignore options they do not know.

**Impact.** The integration looks healthy and captures nothing, or model identity and session handling are missing from MCP events. There is no error.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 3: general install paragraph with the captureModel floors, v2 section for >=0.11.2, Python section for posthog>=7.40.0)

**Sources.** [PostHog/context-mill#344](https://github.com/PostHog/context-mill/pull/344), [PostHog/context-mill#372](https://github.com/PostHog/context-mill/pull/372)

**Frameworks.** `mcp-typescript-sdk`, `mcp-analytics`, `python`

**Wrong:**

```typescript
// package.json: "@posthog/mcp": "0.11.1"
import { McpServer } from "@modelcontextprotocol/server"   // MCP SDK v2
const analytics = instrument(server, posthog)   // rejection swallowed; zero events
// "@posthog/mcp": "0.11.0" + captureModel: true  -> option ignored
# Python: posthog<7.40.0 with MCP SDK 2.x / 2026-07-28 code
```

**Fixed:**

```shell
# v2 servers need @posthog/mcp >= 0.11.2
# captureModel: >= 0.12.0 (wrapping) / >= 0.13.0 (custom dispatcher)
# Python: posthog>=7.40.0 for MCP SDK 2.x and 2026-07-28
pnpm add @posthog/mcp@<latest> posthog-node   # upgrade BEFORE enabling
# read the installed version back from package.json / lockfile, don't guess
```

## MCP SDK peers added or versions guessed

**Problem.** Both MCP SDK majors are optional peers of @posthog/mcp, and the SDKs are new and pre-1.0. So the agent adds an MCP SDK to be safe, often the major the project does not use, and guesses versions without the posthog floor that ships posthog.mcp.

**Impact.** A whole unused SDK is pulled in and can mismatch the major the project uses. Minor releases break the integration, or an old posthog has no posthog.mcp.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 3: Install the SDK, TypeScript and Python sections)

**Sources.** [PostHog/context-mill#344](https://github.com/PostHog/context-mill/pull/344), [PostHog/context-mill#202](https://github.com/PostHog/context-mill/pull/202), [PostHog/context-mill#205](https://github.com/PostHog/context-mill/pull/205)

**Frameworks.** `mcp-typescript-sdk`, `mcp`, `node`, `python`

**Wrong:**

```shell
pnpm add @posthog/mcp posthog-node @modelcontextprotocol/server
# project already uses @modelcontextprotocol/sdk (v1); @posthog/mcp version guessed
pip install posthog mcp fastmcp     # adds peer deps, no floor
```

**Fixed:**

```shell
pnpm add @posthog/mcp@latest posthog-node   # read version back from lockfile
pip install "posthog>=7.40.0"               # posthog.mcp ships inside posthog
# never install an MCP SDK: mcp / fastmcp / @modelcontextprotocol/* are peers
# the project already has
```

## Installs with the wrong package manager

**Problem.** Docs and training data show npm install by default, and a quick look at the lockfiles misses workspaces, multiple lockfiles and Python or JVM managers. Writing straight into package.json looks quicker than running an install.

**Impact.** A second lockfile appears (package-lock.json next to pnpm-lock.yaml), the dependency tree drifts from the real one, and many tool calls are wasted hunting for lockfiles.

**Rule location.**

- wizard (main): src/programs/detection/package-manager.ts
- src/lib/wizard-tools/mcp.ts (detect\_package\_manager)
- src/agent/commandments.ts (WIZARD\_COMMANDMENTS)
- src/programs/framework-config.ts (DEFAULT\_PACKAGE\_INSTALLATION)
- [`context-mill: context/skills/integration-v2/install/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/install/description.md) (lockfile to manager map)
- [`context-mill: context/skills/migrate/references/5-cleanup.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/5-cleanup.md)
- `context-mill: context/skills/omnibus/instrument-*/description.md`

**Sources.** [PostHog/wizard#63](https://github.com/PostHog/wizard/issues/63), [PostHog/wizard#112](https://github.com/PostHog/wizard/issues/112), [PostHog/wizard#82](https://github.com/PostHog/wizard/pull/82), [PostHog/wizard#160](https://github.com/PostHog/wizard/pull/160), [PostHog/wizard#277](https://github.com/PostHog/wizard/pull/277), [PostHog/wizard#306](https://github.com/PostHog/wizard/pull/306), [PostHog/wizard#892](https://github.com/PostHog/wizard/pull/892), [PostHog/context-mill#53](https://github.com/PostHog/context-mill/issues/53), [PostHog/context-mill#87](https://github.com/PostHog/context-mill/pull/87), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `all`, `javascript`, `nextjs`, `react`, `python`, `java`

**Wrong:**

```bash
ls; find . -name "*.lock" -not -path "*/node_modules/*"
npm install posthog-js     # repo actually uses pnpm-lock.yaml
# creates package-lock.json next to pnpm-lock.yaml
npm uninstall statsig-js
// or a hand edit: "dependencies": { "posthog-js": "^1.0.0" }
```

**Fixed:**

```text
detect_package_manager  (wizard-tools MCP)
-> {"primary":{"name":"pnpm","installCommand":"pnpm add"},
    "recommendation":"Use pnpm (pnpm add)."}
pnpm add posthog-js
pnpm remove statsig-js     # then run pnpm install: one resolution, never skip it
# no lockfile: "Default to npm (npm add, npm run)."
# Python: uv/poetry/pdm/pipenv/conda; Java: Maven or Gradle
```

## pip used outside the project's Python environment

**Problem.** Training data mostly shows pip install posthog. The model does not look for uv.lock, poetry.lock, Pipfile.lock or an existing venv first, and creates a new venv or uses the system interpreter.

**Impact.** posthog lands in the system interpreter or the wrong environment and never reaches pyproject or the lockfile, so a clean install later does not have it. An externally managed system Python rejects the install.

**Rule location.**

- wizard (main): src/programs/frameworks/python/utils.ts (detectPackageManager)
- src/programs/framework-config.ts#PYTHON\_PACKAGE\_INSTALLATION
- src/agent/runner/harness/pi/runtime-notes.ts (BASH\_SCOPE Python bullet)

**Sources.** [PostHog/wizard#254](https://github.com/PostHog/wizard/pull/254), [PostHog/wizard#234](https://github.com/PostHog/wizard/pull/234), [PostHog/wizard#230](https://github.com/PostHog/wizard/pull/230), [PostHog/wizard#995](https://github.com/PostHog/wizard/pull/995), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `python`, `django`, `flask`, `fastapi`

**Wrong:**

```bash
pip3 install posthog     # project has uv.lock or [tool.poetry] in pyproject.toml
# error: externally-managed-environment (system interpreter)
python3 -m venv .venv    # created blindly although .venv/ or uv.lock exists
```

**Fixed:**

```bash
# FIRST look for .venv/ venv/ env/
uv add posthog          # uv.lock present
poetry add posthog      # [tool.poetry] / poetry.lock
pipenv install posthog  # Pipfile.lock
# only if nothing found (requirements.txt/setup.py manifest):
python3 -m venv .venv && .venv/bin/pip install posthog
```

## Assumes bare python and pip exist

**Problem.** Docs and training data spell commands as python and pip, but macOS and most modern Linux hosts only ship python3 and pip3.

**Impact.** Exit 127 command not found. Before the fence learned the venv shapes (#1003/#995), bare python -m venv was also rejected as 'python is not an allowed tool', and three orchestrator runs died on 'pip: command not found'.

**Rule location.**

- wizard (main): src/agent/runner/harness/pi/runtime-notes.ts (BASH\_SCOPE Python bullet)
- src/agent/bash-fence.ts (VENV\_BIN, python/python3 -m venv and -m pip shapes)
- src/programs/framework-config.ts (PYTHON\_PACKAGE\_INSTALLATION)

**Sources.** [PostHog/wizard#1003](https://github.com/PostHog/wizard/pull/1003), [PostHog/wizard#995](https://github.com/PostHog/wizard/pull/995), [PostHog/wizard#892](https://github.com/PostHog/wizard/pull/892)

**Frameworks.** `python`, `django`, `flask`, `fastapi`

**Wrong:**

```bash
pip install posthog          # pip: command not found (exit 127)
python -m venv .venv         # python: command not found on macOS / modern Linux
python manage.py check       # same
```

**Fixed:**

```bash
ls -d .venv venv env           # reuse an existing venv
python3 -m venv .venv          # only if none exists
.venv/bin/pip install posthog  # VENV_BIN path allowed by the fence
.venv/bin/python manage.py check
# note: always spell the interpreter python3 and the installer pip3
```

## pip install never recorded in requirements

**Problem.** uv add and poetry add update the manifest, so the agent assumes pip does too. The local import works, so nothing flags the gap until deploy.

**Impact.** Works locally, then CI, deploy or a fresh clone fails with ImportError for posthog.

**Rule location.**

- `wizard: src/lib/framework-config.ts` (PYTHON\_PACKAGE\_INSTALLATION, used by the django/flask/fastapi/python agent configs)
- src/lib/detection/package-manager.ts (detectPythonPackageManagers, PYTHON\_PM\_INFO)

**Sources.** [PostHog/wizard#277](https://github.com/PostHog/wizard/pull/277), [wizard@8a6a4af](https://github.com/PostHog/wizard/commit/8a6a4af1)

**Frameworks.** `python`, `django`, `flask`, `fastapi`

**Wrong:**

```bash
pip install posthog
# requirements.txt / pyproject.toml unchanged
```

**Fixed:**

```text
// PYTHON_PACKAGE_INSTALLATION (framework-config.ts):
// "Use the detect_package_manager tool to determine the package manager.
// If the detected tool manages dependencies directly (e.g. uv add, poetry add),
// use it - it will update the manifest automatically. If using pip, you must
// also add the dependency to requirements.txt or the appropriate manifest file."
// detect_package_manager -> { primary: uv, installCommand: "uv add" }
```

## Lockfile search drowns in node\_modules

**Problem.** A loose glob like \*\*/\*lock\* looks like the natural way to find the manager. It also matches every nested lockfile inside node\_modules.

**Impact.** Turns are wasted on hundreds of hits, and the agent may pick the wrong package manager.

**Rule location.**

- `wizard: src/utils/rules/universal.md` (detect\_package\_manager commandment, snapshotted in src/lib/agent/\_\_tests\_\_/\_\_snapshots\_\_/commandments.test.ts.snap)
- src/lib/framework-config.ts (DEFAULT\_PACKAGE\_INSTALLATION)
- src/utils/package-manager.ts

**Sources.** [PostHog/wizard#243](https://github.com/PostHog/wizard/pull/243), [PostHog/wizard#249](https://github.com/PostHog/wizard/pull/249), [PostHog/wizard#277](https://github.com/PostHog/wizard/pull/277)

**Frameworks.** `javascript`

**Wrong:**

```text
Glob(pattern="**/*lock*")
# -> hundreds of node_modules/**/package-lock.json hits
```

**Fixed:**

```text
// universal.md rule, injected as a commandment:
// "Always use the detect_package_manager tool from the wizard-tools MCP server
// to determine the package manager. Do not guess based on lockfiles or
// hard-code npm, yarn, pnpm, bun, pip, etc."
detect_package_manager()   // returns manager name + install command
// #249 (older prompt): exclude node_modules when seeking lockfiles
```

## Blocked install leads to hollow success

**Problem.** When a shell fence denies composer, bundle, swift, gradle or cargo, a careful agent follows 'never ship captures against an uninstalled SDK' literally and changes nothing. A looser one edits the manifest as a plain file. Both look like progress and no error surfaces.

**Impact.** The run reaches the outro as successful with zero application files changed, or ships a hand-edited composer.json/Gemfile with a wildcard or unresolved version and a stale lockfile, so the SDK is missing at runtime.

**Rule location.** `wizard: src/lib/agent/bash-fence.ts` (SIMPLE\_MANAGERS, BUNDLE\_SUBCOMMANDS, GO\_SUBCOMMANDS, GRADLE\_EXACT\_TASKS/GRADLE\_TASK\_VERBS, MAVEN\_GOALS, XCODEBUILD\_DENIED\_ACTIONS, deny messages)

**Sources.** [PostHog/wizard#888](https://github.com/PostHog/wizard/issues/888), [PostHog/wizard#892](https://github.com/PostHog/wizard/pull/892), [PostHog/wizard#947](https://github.com/PostHog/wizard/pull/947), [PostHog/wizard#942](https://github.com/PostHog/wizard/pull/942)

**Frameworks.** `laravel`, `php`, `rails`, `ruby`, `swift`, `android`, `kmp`, `go`, `rust`, `elixir`, `java`

**Wrong:**

```text
> composer require posthog/posthog-php
Bash command not allowed: `composer` is not an allowed tool.
# terra: event plan written to report, 0 app files changed, outro says success
# sonnet/luna: edits composer.json by hand, composer.lock untouched
+   "posthog/posthog-php": "*",
```

**Fixed:**

```typescript
composer: ['install','require','update','remove','show'],
bundle: BUNDLE_SUBCOMMANDS, // install, add, remove, update, show
swift: ['package','build'],  pod: ['install','update','search'],
cargo: ['add','remove','build','check','fmt','clippy','metadata','tree','fetch'],
// deny text teaches the valid shape:
// "Allowed swift subcommands: package, build."
```

## Flutter pub add refused by the sandbox

**Problem.** The agent uses the right command, but a bash allowlist written for JS and Python has no flutter or dart grammar, so the agent hands the install back to the user.

**Impact.** The report tells the user to run flutter pub add posthog\_flutter themselves, so the integration is incomplete.

**Rule location.** `wizard: src/lib/agent/bash-fence.ts` (PUB\_SUBCOMMANDS, FLUTTER\_DART\_SUBCOMMANDS)

**Sources.** [PostHog/wizard#942](https://github.com/PostHog/wizard/pull/942), [wizard@8e5537b](https://github.com/PostHog/wizard/commit/8e5537b8)

**Frameworks.** `flutter`

**Wrong:**

```shell
flutter pub add posthog_flutter
# -> denied by bash fence (no flutter/dart entry)
# report: "please run flutter pub add posthog_flutter yourself"
```

**Fixed:**

```ts
const PUB_SUBCOMMANDS = ['add','remove','get','upgrade','outdated','deps'];
const FLUTTER_DART_SUBCOMMANDS = ['analyze','build','clean','doctor'];
// flutter run, flutter test, dart run, pub run stay denied (arbitrary code)
```

## Install retry spiral on environment failures

**Problem.** Agents are trained to push through errors and treat every install error as theirs to fix. On ERESOLVE or a corepack failure they try --force, --legacy-peer-deps, offline flags, lockfile deletion and cache surgery, even when the conflict was already in the project.

**Impact.** The run burns its budget or ends failed on a problem the integration did not cause. It can leave the lockfile unsupported or touch the global store, the PostHog dependency is never declared, and the real conflict is never reported.

**Rule location.**

- [`context-mill: context/agents/integration-v2/install.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/install.md) (environment failures list, fallback versions)
- [`context-mill: context/skills/integration-v2/install/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/install/description.md) (run once, do not spiral)
- `context-mill: context/agents/integration-v2/build/description.md` equivalent at context/skills/integration-v2/build/description.md (no offline flags, no global store or cache)

**Sources.** [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275), [context-mill@9c615a3](https://github.com/PostHog/context-mill/commit/9c615a3f), [context-mill@3a9a57d](https://github.com/PostHog/context-mill/commit/3a9a57da), [PostHog/wizard#1325](https://github.com/PostHog/wizard/issues/1325)

**Frameworks.** `all`

**Wrong:**

```shell
npm install posthog-js            # ERESOLVE: conflict the project already had
npm install posthog-js --legacy-peer-deps
npm install --offline posthog-js
rm -rf node_modules package-lock.json; npm install   # corepack error
rm -rf ~/.npm/_cacache && npm install posthog-js
pnpm store prune
```

**Fixed:**

```text
# Attempt the install once. Fix and retry only what you own (wrong package or manager).
# If the failure names another dependency, a project pin or the toolchain
# (ERESOLVE, 'Failed to switch pnpm to', no registry): do NOT spiral retrying.
# Declare the SDK at a known-good caret (posthog-js "^1.407.2"), put the exact
# command + error in the handoff, finish.
```

## Fallback refuses to declare SDK without version

**Problem.** Once told never to invent a version, the agent over-corrects. When the manager cannot run and the reference has no version, it declines to write the dependency at all.

**Impact.** The run aborts, or later steps import a package the manifest never declares.

**Rule location.** [`context-mill: context/agents/integration-v2/install.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/install.md) (fallback paragraph, known-good caret list)

**Sources.** [context-mill@306349f](https://github.com/PostHog/context-mill/commit/306349fd), [context-mill@0fbc77f](https://github.com/PostHog/context-mill/commit/0fbc77fc), [PostHog/context-mill#275](https://github.com/PostHog/context-mill/pull/275)

**Frameworks.** `laravel`, `php`, `ruby`, `python`, `javascript`

**Wrong:**

```text
# composer install fails (no network); reference example names no version
# -> agent declines to edit composer.json, task fails, run aborts
```

**Fixed:**

```json
"require": { "posthog/posthog-php": "^4.12.1" }
// known-good carets: posthog-js ^1.407.2, posthog-node ^5.46.1,
// posthog (Python) ^7.29.0, posthog-ruby ^3.21.0
// handoff states the failed command; review surfaces it
```

## SDK imported but never added to manifest

**Problem.** Writing the import and init code feels like the integration, so the agent treats the install as done. When the harness gives no way to find the package manager, or a later split step imports a package the install step never added (such as posthog-node), the install quietly drops out.

**Impact.** The app fails to build or crashes on a missing module on first run, or a diff ships imports for a package absent from the manifest.

**Rule location.**

- `wizard: src/lib/agent/runner/harness/pi/tools.ts` (detect\_package\_manager)
- src/lib/agent/runner/harness/pi/runtime-notes.ts (SKILL\_STEPS)
- src/lib/agent/commandments.ts
- [`context-mill: context/agents/integration-v2/install.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/install.md) (How you know you succeeded)

**Sources.** [PostHog/wizard#793](https://github.com/PostHog/wizard/pull/793), [wizard@3aafb51](https://github.com/PostHog/wizard/commit/3aafb515), [context-mill@881ca9f](https://github.com/PostHog/context-mill/commit/881ca9f7), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `javascript_web`, `javascript_node`, `nextjs`, `react`, `astro`, `sveltekit`

**Wrong:**

```typescript
// package.json has only posthog-js
// app/api/checkout/route.ts
import { PostHog } from 'posthog-node'   // never declared
export const posthog = new PostHog(process.env.POSTHOG_PROJECT_TOKEN!, {
  host: process.env.POSTHOG_HOST,
})
```

**Fixed:**

```text
detect_package_manager()   // -> install command per manager
// bash: pnpm add posthog-js posthog-node
// tool: 'the SDK package must end up in the project manifest, or the app will not build'
// SKILL_STEPS: install the SDK, import it, INITIALIZE it, only then add capture
// install handoff names manifest + package so later steps import the real name
```

## Bare posthog package installed from npm

**Problem.** The Python package is named plain posthog, and the model carries that name over to npm. The JS SDKs always have a suffix.

**Impact.** The real SDK is never installed. The bare name could be an unrelated, typo-squat or supply-chain package with its own lifecycle scripts, and imports of posthog-js or posthog-node fail.

**Rule location.**

- warlock: src/scanner/rules/supply\_chain\_wrong\_posthog\_package.yar
- `wizard: src/lib/yara-hooks.ts` (createPreToolUseYaraHooks)

**Sources.** [PostHog/warlock](https://github.com/PostHog/warlock), [PostHog/warlock#13](https://github.com/PostHog/warlock/pull/13), [PostHog/wizard#305](https://github.com/PostHog/wizard/pull/305), [PostHog/wizard#597](https://github.com/PostHog/wizard/pull/597)

**Frameworks.** `javascript-web`, `javascript-node`, `nextjs`, `react`, `vue`, `svelte`

**Wrong:**

```shell
npm install posthog
pnpm add posthog
```

**Fixed:**

```shell
# warlock supply_chain_wrong_posthog_package (high, block) via PreToolUse Bash hook
# covers npm, pnpm, yarn, bun, deno
npm install posthog-js      # browser
npm install posthog-node    # server
# pip install posthog stays correct for Python
```

## AI wrapper forced past a peer conflict

**Problem.** When @posthog/ai wants a newer openai major than the app has, --legacy-peer-deps, --force or an older wrapper makes the install succeed. The build still passes, so the agent reports success.

**Impact.** The wrapper runs against an unsupported openai major, or a nested second openai copy sits beside the app's. The outcome differs from run to run while the report says done.

**Rule location.**

- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) (Install and verify)
- [`context-mill: context/agents/integration-v2/ai-observability.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/ai-observability.md)
- [`context-mill: context/skills/ai-observability/references/2-install.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/2-install.md) and 4-verify.md
- [`context-mill: context/skills/integration/references/2-edit.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/2-edit.md) and 3-revise.md
- [`wizard-workbench: services/pr-evaluator/prompts/evaluation-ai-observability.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-ai-observability.md) (as\_dependency\_version\_valid)

**Sources.** [PostHog/wizard#1325](https://github.com/PostHog/wizard/issues/1325), [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390), [context-mill@2151f43](https://github.com/PostHog/context-mill/commit/2151f434)

**Frameworks.** `javascript_node`, `python`, `openai`, `ai-observability`

**Wrong:**

```json
"@posthog/ai": "^8.13.1",   // peer openai ^6; installed with --legacy-peer-deps
"openai": "^4.77.0"
// or: "@posthog/ai": "^6.4.3" -> nested openai 5.23.2 next to the app's v4
// or: npm install openai@latest
```

**Fixed:**

```text
# never --force / --legacy-peer-deps; never upgrade the app's openai
npm install @posthog/ai   # ERESOLVE? an earlier major only if it peers the app's openai
# none fits -> manual capture, record the incompatibility
npm ls openai             # must show one openai major
# grader as_dependency_version_valid: peers must match the app's vendor SDK
```

## Upgrades the app's own packages to fit PostHog

**Problem.** On a peer-range conflict the fastest fix is to bump the app's dependency. To an agent focused on making the install pass, that looks harmless.

**Impact.** Major upgrades of the user's stack that nobody asked for, and breakage unrelated to PostHog.

**Rule location.**

- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md)
- [`context-mill: context/skills/integration/references/3-revise.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/3-revise.md)
- [`context-mill: context/agents/integration-v2/ai-observability.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/ai-observability.md)

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390), [context-mill@2151f43](https://github.com/PostHog/context-mill/commit/2151f434)

**Frameworks.** `all`

**Wrong:**

```bash
# instrumentation peer needs @opentelemetry/api ^2, app has ^1
npm install @opentelemetry/api@latest   # touches the app's dependency
```

**Fixed:**

```bash
# never upgrade, downgrade or re-add a package this integration did not introduce
pkg@^7 -> pkg@^6 -> ...   # step the instrumentation package down majors, a few attempts
# none fits: revert that piece of instrumentation, record the incompatibility
```

## Edits app code to dodge stale SDK

**Problem.** A crash inside the wrapped call looks like an app bug, so the agent changes the app's message handling instead of fixing the SDK version that resolved.

**Impact.** App behavior changes to hide a version problem, and the run passes.

**Rule location.**

- `wizard-workbench: evaluation-ai-observability.md` (as\_dependency\_version\_valid)
- [`context-mill: context/skills/ai-observability/references/2-install.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/2-install.md)

**Sources.** [`wizard-workbench: apps/ai-observability/openai/python-weather/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/openai/python-weather/README.md), [PostHog/wizard#1325](https://github.com/PostHog/wizard/issues/1325)

**Frameworks.** `python`, `openai`

**Wrong:**

```python
self.messages.append(message.model_dump())   # dict-ified to dodge a crash on old posthog
```

**Fixed:**

```python
self.messages.append(message)   # app code untouched
# resolve posthog >= 7.x that supports the app's vendor SDK major;
# never upgrade or duplicate the vendor SDK
```

## Skill and wizard disagree on who installs

**Problem.** One layer says never run the package manager and another says run it synchronously, so the agent has no rule to follow when the install fails (ERESOLVE).

**Impact.** The outcome varies by run and model. Two runs on the same fixture ended in two different dependency states, and both reported success.

**Rule location.**

- `context-mill: context/agents/integration-v2/install.md:38` (model rule, ai-observability references/2-install.md:7,44 still says do not run the package manager). wizard (main): src/programs/ai-observability/index.ts:51-52
- src/agent/runner/harness/pi/runtime-notes.ts:53

**Sources.** [PostHog/wizard#1325](https://github.com/PostHog/wizard/issues/1325)

**Frameworks.** `all`

**Wrong:**

```text
skill 2-install.md: "Do not run `npm install` or `pip install`."
wizard programs/ai-observability/index.ts: "The skill itself will install packages"
pi runtime-notes.ts: "Run installs synchronously and wait (e.g. `npm install <pkg>`)"
```

**Fixed:**

```text
# integration-v2/install.md: one attempt, then a defined fallback
Attempt the install once.
...These are environment failures, not yours:
- a peer-dependency conflict the project already had (npm `ERESOLVE`),
...fall back: add the PostHog package to the manifest by hand at a known-good version
```

## Unused posthog-js next to the Astro snippet

**Problem.** Installing the npm package is the agent's default first step. In Astro static sites the integration then loads PostHog from the CDN snippet instead.

**Impact.** A dead dependency that bloats node\_modules, and confusion about which SDK copy is running.

**Rule location.** [`context-mill: example-apps/astro-static/package.json`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-static/package.json) (no posthog-js, README says it uses the web snippet). No explicit commandment forbids the npm package: commandments.yaml#astro only requires is:inline snippet tags, so this is example-driven, not a stated rule

**Sources.** [PostHog/wizard-workbench#1040](https://github.com/PostHog/wizard-workbench/pull/1040), [PostHog/wizard-workbench#3676](https://github.com/PostHog/wizard-workbench/pull/3676), [PostHog/wizard-workbench#4338](https://github.com/PostHog/wizard-workbench/pull/4338)

**Frameworks.** `astro`

**Wrong:**

```json
"dependencies": {
  "astro": "^5.10.2",
  "posthog-js": "^1.399.5"   // never imported; snippet loads from CDN
}
```

**Fixed:**

```json
"dependencies": { "astro": "^5.10.2" },
"devDependencies": { "typescript": "^5.9.3" }
// astro-static example app: snippet only, no npm SDK
```

## React Native SDK installed without peers

**Problem.** Installing posthog-react-native alone succeeds, and missing optional or native peers do not fail the install. Metro errors only when the code path loads, and the iOS build only breaks later.

**Impact.** Without a storage peer the SDK keeps state in memory, so the anonymous id resets on every launch. Without react-native-svg, surveys crash or Metro cannot resolve it. Without the device peers the SDK loses device context. Skipping pod install breaks the iOS build.

**Rule location.**

- [`context-mill: context/commandments.yaml#react-native`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) line 264 (react-native-svg required peer, the only commandment)
- peer lists in doc comments of example-apps/expo/src/config/posthog.ts and example-apps/react-native/src/config/posthog.ts and in the example package.json files. wizard (main): src/programs/frameworks/react-native/react-native-wizard-agent.ts (lines 88 'npx expo install', 94 and 119 pods via npx pod-install)

**Sources.** [PostHog/context-mill#94](https://github.com/PostHog/context-mill/pull/94), [PostHog/context-mill#75](https://github.com/PostHog/context-mill/pull/75), [`posthog-js: packages/react-native/src/posthog-rn.ts`](https://github.com/PostHog/posthog-js/blob/HEAD/packages/react-native/src/posthog-rn.ts)

**Frameworks.** `react-native`, `expo`

**Wrong:**

```shell
npm install posthog-react-native
# or
npx expo install posthog-react-native
```

**Fixed:**

```shell
# Expo
npx expo install posthog-react-native react-native-svg \
  expo-file-system expo-application expo-device expo-localization
# bare RN
npm install posthog-react-native react-native-svg @react-native-async-storage/async-storage \
  react-native-device-info react-native-localize
cd ios && pod install
```

## Go OTel path given the core Go SDK

**Problem.** The general Go rules say to install posthog-go and build a client with NewWithConfig. The AI observability OTel path uses a separate nested module that builds no client.

**Impact.** The wrong module is installed and the bridge never uses the client, so spans are not exported.

**Rule location.**

- [`context-mill: context/commandments.yaml#ai_observability`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (Go OpenTelemetry carve-out, line 337)
- [`context-mill: context/skills/ai-observability/references/2-install.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/2-install.md) (opentelemetry-go row and Go exception)

**Sources.** [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373), [context-mill@09eb2e6](https://github.com/PostHog/context-mill/commit/09eb2e69)

**Frameworks.** `go`

**Wrong:**

```go
go get github.com/posthog/posthog-go
client, _ := posthog.NewWithConfig(token, posthog.Config{Endpoint: host})
```

**Fixed:**

```text
go get github.com/posthog/posthog-go/otel go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk
// bridge registers a span processor; it builds no PostHog client
```

## Hand-edited go.mod or Cargo.toml

**Problem.** Adding a require line looks like the simplest edit, but go.sum and Cargo.lock need the toolchain to write matching checksums.

**Impact.** The build fails with 'missing go.sum entry for module', or a guessed version is pinned. go mod edit can also point modules at arbitrary sources.

**Rule location.**

- wizard (main): src/programs/frameworks/go/go-wizard-agent.ts:70 and src/programs/frameworks/rust/rust-wizard-agent.ts:71 (packageInstallation)
- src/agent/bash-fence.ts:134-137 (GO\_MOD\_SUBCOMMANDS)
- `context-mill: context/skills/ai-observability/references/2-install.md:38`

**Sources.** [PostHog/wizard#945](https://github.com/PostHog/wizard/pull/945), [PostHog/wizard#947](https://github.com/PostHog/wizard/pull/947), [PostHog/wizard#892](https://github.com/PostHog/wizard/pull/892), [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373)

**Frameworks.** `go`, `rust`

**Wrong:**

```go
// go.mod edited by hand
require github.com/posthog/posthog-go/otel v1.0.0
// go build: missing go.sum entry for module
```

**Fixed:**

```bash
go get github.com/posthog/posthog-go/otel go.opentelemetry.io/otel
go mod tidy   # fence allows tidy|download|verify|graph|why; `go mod edit` denied
cargo add posthog-rs   # cargo writes Cargo.toml and Cargo.lock
# never hand-edit go.mod, go.sum or Cargo.toml
```

## Async Rust client forced on sync app

**Problem.** posthog-rs defaults to its async client, so after a plain cargo add the agent adds tokio and #\[tokio::main\] to make it compile.

**Impact.** A new runtime and dependency in a synchronous app, or mixed async and blocking calls that panic at runtime.

**Rule location.** wizard (main): src/programs/frameworks/rust/rust-wizard-agent.ts:21-24 (hasAsyncRuntime), :77-84 (getAdditionalContextLines)

**Sources.** [PostHog/wizard#947](https://github.com/PostHog/wizard/pull/947)

**Frameworks.** `rust`

**Wrong:**

```rust
// sync CLI, no tokio in Cargo.toml
#[tokio::main]
async fn main() {
    let client = posthog_rs::client(opts).await;
}
```

**Fixed:**

```shell
# no tokio/async-std/smol in Cargo.toml:
cargo add posthog-rs --no-default-features   # blocking client
// and drop the .await
```

## Skill download depends on curl and unzip

**Problem.** Calling curl and unzip from the shell works on a dev Mac. Stock Windows often has no unzip and sometimes no temp folder, and the failures were not logged.

**Impact.** Skill installs fail without any visible error, so the agent runs without its integration guidance.

**Rule location.**

- `wizard: src/lib/wizard-tools/tools.ts` (downloadSkill, downloadWithRetry, extractZipArchive)
- src/lib/fetch-retry.ts (fetchWithRetry, isRetryableStatus)

**Sources.** [PostHog/wizard#807](https://github.com/PostHog/wizard/pull/807), [PostHog/wizard#809](https://github.com/PostHog/wizard/pull/809), [PostHog/wizard#814](https://github.com/PostHog/wizard/pull/814), [PostHog/wizard#829](https://github.com/PostHog/wizard/pull/829)

**Frameworks.** `all`

**Wrong:**

```typescript
execFileSync('curl', ['-sL', skillEntry.downloadUrl, '-o', tmpFile], { timeout: 30000 })
execFileSync('unzip', ['-o', tmpFile, '-d', skillDir])
// %TEMP% may not exist on Windows; curl will not create it
```

**Fixed:**

```typescript
// downloadSkill: no shell tools, no temp file
const data = await fetchWithRetry(skillEntry.downloadUrl)   // 3 attempts, 60s each, GitHub -> AWS failover
  .then(async (r) => new Uint8Array(await r.arrayBuffer()))
const fileCount = extractZipArchive(data, skillDir)         // fflate unzipSync + zip-slip check
// failure => analytics 'skill install failed' { skill_id, step, platform, error }
```

## Sandbox blocks corepack and Volta installs

**Problem.** A project that pins its package manager (corepack packageManager or Volta) needs writes to toolchain and cache folders outside the project. A sandbox scoped to the project denies them.

**Impact.** The install fails, so the PostHog dependency never lands, or the agent works around the sandbox.

**Rule location.** [`wizard: src/agent/agent-interface.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/agent-interface.ts) (older checkout: src/lib/agent/agent-interface.ts), sandbox.filesystem.allowWrite

**Sources.** [PostHog/wizard#474](https://github.com/PostHog/wizard/pull/474), [PostHog/wizard#933](https://github.com/PostHog/wizard/pull/933)

**Frameworks.** `javascript`, `python`, `rails`

**Wrong:**

```text
// project pins "packageManager": "pnpm@9.x" (corepack) or Volta
// pnpm add posthog-js must write ~/Library/pnpm/.tools or ~/.volta
// sandbox allowWrite: [projectDir]   -> EPERM
```

**Fixed:**

```typescript
allowWrite: [
  '~/Library/pnpm/**',   // store + .tools/ for packageManager pinning
  '~/.cache/node/corepack/**', '~/.volta/**', '~/.bun/install/**',
  '~/.cache/pip/**', '~/.cache/uv/**', '~/.cache/pypoetry/**',
  '~/.bundle/**', '~/.gem/**',
]
```

## Install backgrounded while the build runs

**Problem.** Starting the install in the background and moving on looks like a free speedup. Wizard #222 added a rule telling agents to do exactly that, so later edits and builds can race the install.

**Impact.** A type check or build can run before the package exists, so verification races the install. Waiting in the foreground only costs time and breaks nothing.

**Rule location.**

- [`wizard: src/agent/runner/harness/pi/runtime-notes.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/harness/pi/runtime-notes.ts) (synchronous installs)
- src/shared/utils/rules/universal.md (background rule still present on main)
- `context-mill: context/skills/omnibus/instrument-*/description.md` and context/skills/error-tracking-upload-source-maps/description.md (background guidance removed in #201)

**Sources.** [PostHog/wizard#222](https://github.com/PostHog/wizard/pull/222), [PostHog/context-mill#201](https://github.com/PostHog/context-mill/pull/201)

**Frameworks.** `all`

**Wrong:**

```shell
npm install posthog-js &     # background, don't await
npm run build                # may run before install finishes
```

**Fixed:**

```text
# pi runtime-notes: 'Run installs synchronously and wait (e.g. npm install <pkg>);
#   &, &&, and pipes are all blocked.'
# context-mill omnibus instrument-* STEP 3: background-install line removed
# NOTE: wizard universal.md still says 'start the installation as a background task'
```

## posthog-cli installed globally or via npm in native apps

**Problem.** The upload docs say npm install -g @posthog/cli, and Flutter web emits plain .js.map files, so the agent treats the app like a JS project. Native projects (Xcode, Gradle, Flutter, Go, Rust) have no package.json for npx or a local dependency.

**Impact.** The global install is blocked for the agent because lifecycle scripts run at higher privilege, turns are wasted, and the build script calls a posthog-cli that is not on PATH. Release builds fail or skip the dSYM, mapping or source map upload.

**Rule location.**

- `wizard: src/lib/programs/shared/posthog-cli-preinstall.ts`
- src/lib/programs/error-tracking-upload-source-maps/detect.ts (VARIANTS\_REQUIRING\_POSTHOG\_CLI)
- warlock: src/scanner/rules/supply\_chain\_npm\_install\_global.yar
- [`context-mill: context/agents/error-tracking/configure.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/configure.md)

**Sources.** [PostHog/wizard#1185](https://github.com/PostHog/wizard/pull/1185), [PostHog/wizard#931](https://github.com/PostHog/wizard/pull/931), [PostHog/wizard#938](https://github.com/PostHog/wizard/pull/938), [PostHog/wizard#941](https://github.com/PostHog/wizard/pull/941), [PostHog/wizard#985](https://github.com/PostHog/wizard/pull/985), [PostHog/warlock#13](https://github.com/PostHog/warlock/pull/13), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/context-mill#262](https://github.com/PostHog/context-mill/pull/262), [wizard@632b80a](https://github.com/PostHog/wizard/commit/632b80aa)

**Frameworks.** `swift`, `ios`, `android`, `react-native`, `flutter`, `go`, `rust`

**Wrong:**

```bash
npm install -g @posthog/cli@latest   # blocked by warlock for the agent
npm install --save-dev @posthog/cli  # Flutter: no package.json
# Xcode Run Script / post-build step:
posthog-cli symbol-sets upload --directory build/
# posthog-cli not on PATH, no package.json to resolve it
```

**Fixed:**

```typescript
// wizard pre-installs once per process, before the agent runs
VARIANTS_REQUIRING_POSTHOG_CLI = new Set(['ios','android','react-native','flutter','go','rust'])
preinstallPostHogCliOnce('source maps posthog-cli preinstall failed', { variant })
// failure => log.warn + analytics event, never a failed run
// skill (error-tracking/configure.md): check `command -v posthog-cli`; if missing do NOT
// install it, name `npm install -g @posthog/cli@latest` as a manual follow-up
```

## Gradle plugin version copied from the SDK

**Problem.** The com.posthog.android plugin has its own version numbers, separate from posthog-android. A reused SDK number or a resolved $version placeholder looks valid but does not exist.

**Impact.** Gradle sync fails to resolve a plugin version that does not exist, and the mapping or symbol upload never runs.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) ('Android (Gradle)' gotcha 3: plugin versioned separately from posthog-android, never reuse the SDK version, Flutter > Android bullet: settings.gradle.kts owns the plugin version)

**Sources.** [PostHog/context-mill#281](https://github.com/PostHog/context-mill/pull/281)

**Frameworks.** `android`, `flutter`

**Wrong:**

```kotlin
// android/app/build.gradle.kts
plugins {
    id("com.posthog.android") version "3.19.0"   // SDK-looking number, no such plugin release
}
```

**Fixed:**

```kotlin
// android/settings.gradle.kts owns plugin versions (Flutter)
plugins { id("com.posthog.android") version "<latest plugin release>" apply false }
// android/app/build.gradle.kts: versionless, never android/build.gradle.kts
plugins { id("com.posthog.android") }
```

## Swift package added with half the Xcode wiring

**Problem.** Editing project.pbxproj by hand, the agent adds only the package reference. Xcode needs three linked objects in three sections.

**Impact.** Xcode does not link the SDK, so import PostHog fails and the project does not build.

**Rule location.** [`context-mill: context/commandments.yaml#swift`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (bullet 'When adding SPM dependencies to project.pbxproj (only when no XcodeGen project.yml exists)')

**Sources.** [PostHog/context-mill#71](https://github.com/PostHog/context-mill/pull/71), [context-mill@dab19f8](https://github.com/PostHog/context-mill/commit/dab19f8e), [context-mill@3ed37d4](https://github.com/PostHog/context-mill/commit/3ed37d49)

**Frameworks.** `swift`, `ios`

**Wrong:**

```text
/* Begin XCRemoteSwiftPackageReference section */
  ABC /* posthog-ios */ = { isa = XCRemoteSwiftPackageReference;
    repositoryURL = "https://github.com/PostHog/posthog-ios"; };
/* no PBXBuildFile, no XCSwiftPackageProductDependency,
   not in packageReferences or the Frameworks phase */
```

**Fixed:**

```text
PBXBuildFile { productRef = <id> /* PostHog */ }             -> Frameworks phase files
XCSwiftPackageProductDependency { package = <ref>; productName = PostHog }
                                                       -> target packageProductDependencies
XCRemoteSwiftPackageReference { repositoryURL; requirement } -> project packageReferences
(each object gets its own unique UUID)
```

## Swift package added to generated Xcode project

**Problem.** Editing project.pbxproj is the usual way to add a package, and nothing signals that XcodeGen regenerates it from project.yml.

**Impact.** The next xcodegen generate drops the PostHog dependency without a warning, and the build breaks later.

**Rule location.**

- [`context-mill: context/commandments.yaml#swift`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (XcodeGen rule)
- [`context-mill: example-apps/swift-xcodegen/project.yml`](https://github.com/PostHog/context-mill/blob/main/example-apps/swift-xcodegen/project.yml)

**Sources.** [PostHog/context-mill#213](https://github.com/PostHog/context-mill/pull/213), [PostHog/wizard#803](https://github.com/PostHog/wizard/pull/803), [context-mill@51ac429](https://github.com/PostHog/context-mill/commit/51ac429e), [PostHog/wizard#1011](https://github.com/PostHog/wizard/pull/1011)

**Frameworks.** `swift`, `xcodegen`

**Wrong:**

```diff
# edits BurritoStand.xcodeproj/project.pbxproj
+ XCRemoteSwiftPackageReference "posthog-ios" { ... }
+ XCSwiftPackageProductDependency { productName = PostHog; }
```

**Fixed:**

```yaml
packages:
  PostHog:
    url: https://github.com/PostHog/posthog-ios
    from: 3.64.1
targets:
  BurritoStand:
    dependencies:
      - package: PostHog
```

## Non-semver dependency values crash version checks

**Problem.** Code that reads package.json assumes every value is a semver range, but monorepos and git dependencies use workspace:\*, tags, URLs and aliases.

**Impact.** Version checks throw or bucket the value as 0.x, so the wizard crashes or gives the wrong framework guidance.

**Rule location.** [`wizard: src/shared/utils/semver.ts#isNonSemverVersion`](https://github.com/PostHog/wizard/blob/main/src/shared/utils/semver.ts) (older local checkout: src/utils/semver.ts)

**Sources.** [PostHog/wizard#338](https://github.com/PostHog/wizard/pull/338), [PostHog/wizard#334](https://github.com/PostHog/wizard/pull/334)

**Frameworks.** `all JS frameworks`

**Wrong:**

```ts
"next": "workspace:*"
"next": "latest"
"next": "git+https://github.com/user/repo.git"
semver.minVersion(value)   // throws or returns 0.x for several of these
```

**Fixed:**

```ts
function isNonSemverVersion(version: string): boolean {
  const v = version.trim();
  return v === '' || v.startsWith('http://') || v.startsWith('https://') ||
    v.startsWith('git+') || v.startsWith('git://') || v.startsWith('file:') ||
    v.startsWith('npm:') || v.startsWith('workspace:') ||
    v.startsWith('/') || v.includes('/');
}
// versionSatisfiesRange -> false, createVersionBucket -> 'unknown'
```

## Plugin install before marketplace is registered

**Problem.** The bare plugin name resolves in an interactive Claude Code session, but the non-interactive subcommand never registers the catalog.

**Impact.** The install fails with 'not found in any configured marketplace' on machines that never opened Claude Code interactively.

**Rule location.** [`wizard: src/shared/mcp-clients/clients/claude-code.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/mcp-clients/clients/claude-code.ts) (installPlugin, ensurePluginMarketplace)

**Sources.** [PostHog/wizard#1294](https://github.com/PostHog/wizard/pull/1294)

**Frameworks.** `claude-code`

**Wrong:**

```shell
claude plugin install posthog
```

**Fixed:**

```shell
claude plugin marketplace add PostHog/ai-plugin
claude plugin install posthog@posthog
# on 'not found in': marketplace update, retry, then bare name
```

## Codex marketplace add reported as install

**Problem.** marketplace add exits 0, which looks like success, but the plugin stays 'not installed' until plugin add runs.

**Impact.** Silent: Codex users get the MCP server but none of the 164 skills, and re-runs say 'already installed'.

**Rule location.** [`wizard: src/shared/mcp-clients/clients/codex.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/mcp-clients/clients/codex.ts) (installPlugin, isPluginPresent)

**Sources.** [PostHog/wizard#1295](https://github.com/PostHog/wizard/pull/1295), [PostHog/wizard#1296](https://github.com/PostHog/wizard/pull/1296)

**Frameworks.** `codex`

**Wrong:**

```shell
codex plugin marketplace add PostHog/ai-plugin   # exit 0
# reports: Plugin installed for: Codex
```

**Fixed:**

```shell
codex plugin marketplace add PostHog/ai-plugin
codex plugin add posthog@posthog
# presence = STATUS column of: codex plugin list -m posthog
```

## Uninstall leaves a second plugin copy

**Problem.** Claude Code allows posthog@posthog and posthog@claude-plugins-official side by side, and a bare uninstall removes only one.

**Impact.** Silent: the other copy keeps serving after removal.

**Rule location.** [`wizard: src/shared/mcp-clients/clients/claude-code.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/mcp-clients/clients/claude-code.ts) (removePlugin)

**Sources.** [PostHog/wizard#1294](https://github.com/PostHog/wizard/pull/1294)

**Frameworks.** `claude-code`

**Wrong:**

```shell
claude plugin uninstall posthog
```

**Fixed:**

```shell
# list --json, then for every id matching posthog@*:
claude plugin uninstall <id>
# remove our marketplace only if its repo is PostHog/ai-plugin
```

## Agent cannot install the upload CLI

**Problem.** The agent assumes posthog-cli exists, or runs `npm install -g` itself in a Go, Rust or Swift project. The harness command fence (warlock) blocks global installs.

**Impact.** The release build fails at upload time with 'command not found', or the install is blocked partway through the run.

**Rule location.**

- [`wizard: src/programs/shared/posthog-cli-preinstall.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/shared/posthog-cli-preinstall.ts)
- src/shared/install-cli-steering/index.ts (installOrUpdatePostHogCli)
- src/programs/error-tracking/index.ts (SYMBOL\_UPLOAD\_CLI\_FRAMEWORKS)

**Sources.** [PostHog/wizard#1185](https://github.com/PostHog/wizard/pull/1185)

**Frameworks.** `swift`, `android`, `react-native`, `flutter`, `go`, `rust`

**Wrong:**

```bash
$ npm install -g @posthog/cli     # blocked by the command fence
# build script later:
posthog-cli sourcemap upload ...  # command not found
```

**Fixed:**

```ts
// wizard pre-installs in-process, once per process
preinstallPostHogCliOnce(failureEvent, props) // -> installOrUpdatePostHogCli():
//   npm install --global @posthog/cli@latest
// failure -> warning + event, not a hard stop (capture still works);
// user is shown: npm install -g @posthog/cli@latest
```
