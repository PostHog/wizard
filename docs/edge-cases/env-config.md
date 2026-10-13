# Missing or misnamed config

41 cases. Part of the [edge case catalogue](../edge-cases.md).

## Env key check looks at one file only

**Problem.** Checking ./.env is the obvious lookup, but real projects keep keys in .env.local or in nested apps/\*/.env.local. The detector's evidence string also always said ".env", so the agent trusted the wrong file and then took 'missing' as a reason to stop instead of asking the user.

**Impact.** A key that is set reads as missing, so the agent gives up and hands the user a browser link. A source it could have connected never gets created. Of 697 completed warehouse tasks, only 247 created a source.

**Rule location.**

- `wizard: src/lib/wizard-tools/tools.ts` (checkEnvKeys, CHECK\_ENV\_KEYS\_DESCRIPTION)
- src/utils/env-scan.ts (collectProjectEnvKeys, ENV\_SCAN\_MAX\_DEPTH=3)
- src/lib/warehouse-sources/detect.ts (matchedSignal)
- src/lib/programs/warehouse-source/index.ts (prompt: trust the path, call check\_env\_keys with no filePath)
- [`context-mill: context/skills/integration-v2/warehouse/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/warehouse/description.md) and context/skills/data-warehouse-source/description.md (workflow step 3: 'A missing answer is not a reason to stop')
- [`wizard-workbench: apps/warehouse/monorepo-env/.wizard-ci/expect.json`](https://github.com/PostHog/wizard-workbench/blob/main/apps/warehouse/monorepo-env/.wizard-ci/expect.json) (expectSignalPath)

**Sources.** [PostHog/wizard#1144](https://github.com/PostHog/wizard/pull/1144), [PostHog/context-mill#359](https://github.com/PostHog/context-mill/pull/359), [PostHog/context-mill#361](https://github.com/PostHog/context-mill/pull/361), [`wizard-workbench: apps/warehouse/monorepo-env/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/warehouse/monorepo-env/README.md)

**Frameworks.** `all`

**Wrong:**

```javascript
check_env_keys({ filePath: '.env', keys: ['OPENAI_API_KEY'] })  -> missing
// key really in apps/api/.env.local
matchedSignal: "found `OPENAI_API_KEY` in .env"   // always .env, even when no root .env exists
// agent: 'key missing, giving the user a browser link'
```

**Fixed:**

```javascript
check_env_keys({ keys: ['OPENAI_API_KEY'] })  // no filePath: scans every .env* up to 3 levels, same walk as the detector
-> { OPENAI_API_KEY: { status: 'present', foundIn: ['apps/api/.env.local'] } }
// reads `export KEY=` lines too; names and paths only, never values
// a key only in .env.example is 'missing' (foundIn lists it); templates are never a write target
matchedSignal: "found `OPENAI_API_KEY` in apps/api/.env.local"
// 'missing' is not a reason to stop: go on and wizard_ask the user
```

## Missing token skipped silently with no dev error

**Problem.** Once told not to crash, the agent over-corrects to `if (key) init()` or an empty-string init. That is quiet everywhere, so a developer never learns why no events arrive.

**Impact.** Silent. No events and no error, and the gap only shows when dashboards stay empty.

**Rule location.**

- [`context-mill: context/commandments.yaml#all`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('...but never silently: in development or debug builds fail loudly... production stays a no-op')
- `wizard: src/lib/agent/commandments.ts` (WIZARD\_COMMANDMENTS: never substitute an empty string or placeholder for the project token)

**Sources.** [context-mill@a371345](https://github.com/PostHog/context-mill/commit/a371345a), [context-mill@66ccf7e](https://github.com/PostHog/context-mill/commit/66ccf7e8), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#260](https://github.com/PostHog/context-mill/pull/260), [PostHog/wizard-workbench#4467](https://github.com/PostHog/wizard-workbench/pull/4467), [PostHog/wizard-workbench#4470](https://github.com/PostHog/wizard-workbench/pull/4470)

**Frameworks.** `all`, `ruby-on-rails`, `react-vite`

**Wrong:**

```typescript
const key = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
if (key) {
  posthog.init(key, { api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST })
}
// key missing: no log, no error, no events

# Rails
PostHog.init { |c| c.api_key = api_key } if api_key.present?  # silently skipped
```

**Fixed:**

```typescript
if (posthogKey && posthogHost) {
  posthog.init(posthogKey, { api_host: posthogHost, defaults: '2026-01-30' })
} else if (import.meta.env.DEV) {
  throw new Error(
    `${missing} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missing} is configured`
  )
}
```

## Empty or placeholder token used as fallback

**Problem.** Defaulting to '' or 'phc\_placeholder' is the usual way to keep code compiling, satisfy a non-optional type and stop init from throwing, and the example apps did it too. Nothing fails: the SDK accepts the dead key and logs nothing.

**Impact.** Silent. Init runs with an empty or fake key, the build passes and no events arrive.

**Rule location.**

- `wizard: src/lib/agent/commandments.ts` (WIZARD\_COMMANDMENTS: 'Never hallucinate a PostHog project token...', 'Never substitute an empty string or placeholder for the project token...')
- [`context-mill: context/commandments.yaml#all`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: context/skills/integration-v2/init/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md)

**Sources.** [context-mill@b528c4f](https://github.com/PostHog/context-mill/commit/b528c4fc), [context-mill@23276d8](https://github.com/PostHog/context-mill/commit/23276d8e), [context-mill@a371345](https://github.com/PostHog/context-mill/commit/a371345a), [PostHog/context-mill#290](https://github.com/PostHog/context-mill/pull/290), [PostHog/wizard#306](https://github.com/PostHog/wizard/pull/306), [PostHog/wizard#1185](https://github.com/PostHog/wizard/pull/1185), [PostHog/wizard-workbench#873](https://github.com/PostHog/wizard-workbench/pull/873), [PostHog/wizard-workbench#2963](https://github.com/PostHog/wizard-workbench/pull/2963)

**Frameworks.** `all`, `android`, `astro`, `vue`, `nuxt`, `javascript_web`, `react-native`, `flutter`, `kmp`

**Wrong:**

```kotlin
// Android (Tusky run)
val token = System.getenv("POSTHOG_PROJECT_TOKEN") ?: ""
PostHogAndroid.setup(this, PostHogAndroidConfig(token))

// Astro example app
posthog.init(apiKey || '', { api_host: apiHost || 'https://us.i.posthog.com' })

// Nuxt fixture (wizard #1185): runtimeConfig.public.posthogKey = 'phc_placeholder'
```

**Fixed:**

```typescript
if (!apiKey || !apiHost) {
  if (mode === 'development') {
    throw new Error(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`);
  }
} else {
  posthog.init(apiKey, { api_host: apiHost, defaults: '2026-01-30' });
}
// where a build has no env (mobile release), embed the real public token instead
```

## Mobile token read from Xcode scheme env

**Problem.** The generic rule says 'use env vars, never hardcode', and the skill used to show a fatalError pattern. Xcode scheme env vars only exist when you run from Xcode, and release builds have no environment, so every local run passes and the shipped build breaks.

**Impact.** Archive, TestFlight and App Store builds crash on launch at the fatalError, or ship a nil or empty token that silently sends nothing.

**Rule location.**

- [`context-mill: context/commandments.yaml#swift`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (also #ios, #android, #kmp)
- [`context-mill: context/skills/integration-v2/init/description.md#Environment`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) variables (no-env exception)
- [`context-mill: example-apps/swift/BurritoConsiderationClient/BurritoConsiderationClientApp.swift`](https://github.com/PostHog/context-mill/blob/main/example-apps/swift/BurritoConsiderationClient/BurritoConsiderationClientApp.swift)
- [`context-mill: example-apps/flutter/lib/posthog/posthog.dart`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/lib/posthog/posthog.dart)
- wizard (main): src/agent/commandments.ts (empty-token rule). Stale: context/skills/posthog-best-practices/description.md line 219 still says 'Read ... from scheme env and fail fast if missing' for Swift, contradicting the rule

**Sources.** [PostHog/context-mill#71](https://github.com/PostHog/context-mill/pull/71), [PostHog/context-mill#171](https://github.com/PostHog/context-mill/pull/171), [PostHog/context-mill#172](https://github.com/PostHog/context-mill/pull/172), [PostHog/context-mill#290](https://github.com/PostHog/context-mill/pull/290), [context-mill@b528c4f](https://github.com/PostHog/context-mill/commit/b528c4fc), [context-mill@0f25c98](https://github.com/PostHog/context-mill/commit/0f25c98b), [PostHog/wizard#259](https://github.com/PostHog/wizard/pull/259)

**Frameworks.** `swift`, `ios`, `swiftui`, `android`, `kmp`, `flutter`

**Wrong:**

```swift
enum PostHogEnv {
  static let token = ProcessInfo.processInfo.environment["POSTHOG_PROJECT_TOKEN"]
    ?? { fatalError("Set POSTHOG_PROJECT_TOKEN in the Xcode scheme") }()
}
PostHogSDK.shared.setup(PostHogConfig(apiKey: PostHogEnv.token, host: PostHogEnv.host))
// or: environment["POSTHOG_PROJECT_TOKEN"] ?? ""   -> archive build ships ""
// Android: PostHogAndroidConfig(System.getenv("POSTHOG_TOKEN") ?: "")
```

**Fixed:**

```swift
// release/archive builds have no environment: ship the real public token
private let posthogProjectToken = "phc_<real project token>"   // public client key, safe to ship
private let posthogHost = "https://us.i.posthog.com"
let config = PostHogConfig(apiKey: posthogProjectToken, host: posthogHost)
PostHogSDK.shared.setup(config)
// scheme env var only as an optional override; never fatalError or force-unwrap
// Flutter: String.fromEnvironment('POSTHOG_PROJECT_TOKEN') (--dart-define), disable if empty
```

## Flutter web snippet ships a placeholder token

**Problem.** The agent copies the docs snippet's phc\_your\_project\_token\_here, or obeys 'never hardcode' by reading a window global that nothing defines. Static HTML cannot read env, and the public token is not a secret.

**Impact.** Silent. The web build passes, PostHog starts with a fake or undefined token, and nothing is captured.

**Rule location.**

- [`context-mill: context/commandments.yaml#flutter`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (Flutter Web bullet: 'write the real token directly into the snippet ... phc\_your\_project\_token\_here is a placeholder for readers')
- [`context-mill: example-apps/flutter/web/index.html`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/web/index.html) (still contains the placeholder token, with a 'Replace the token below' comment)
- [`context-mill: context/skills/integration-v2/init/description.md#Environment`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) variables

**Sources.** [context-mill@e47207b](https://github.com/PostHog/context-mill/commit/e47207bf), [context-mill@2b23a5f](https://github.com/PostHog/context-mill/commit/2b23a5f1), [context-mill@81ce684](https://github.com/PostHog/context-mill/commit/81ce6844), [PostHog/context-mill#346](https://github.com/PostHog/context-mill/pull/346), [PostHog/context-mill#290](https://github.com/PostHog/context-mill/pull/290), [wizard-workbench@54ecc1a](https://github.com/PostHog/wizard-workbench/commit/54ecc1ad6), [PostHog/wizard-workbench#3503](https://github.com/PostHog/wizard-workbench/pull/3503), [wizard-workbench@84dc3a3](https://github.com/PostHog/wizard-workbench/commit/84dc3a3d5)

**Frameworks.** `flutter`, `javascript_web`

**Wrong:**

```html
<!-- web/index.html -->
posthog.init('phc_your_project_token_here', {
  api_host: 'https://us.i.posthog.com',
})
<!-- or: posthog.init(window.POSTHOG_PROJECT_TOKEN, ...)  a 'later build step' never defines it -->
```

**Fixed:**

```html
<!-- web/index.html: HTML cannot read env, and the token is public -->
posthog.init('phc_<the configured project token>', {
  api_host: 'https://us.i.posthog.com',
  defaults: '2025-05-24',
})
<!-- phc_your_project_token_here is a placeholder for readers, not code to copy -->
```

## Project token pasted into init code

**Problem.** The prompt hands the agent a token and host, and quickstart snippets show literals, so pasting them inline is the shortest path that works. The mobile and static-web carve-outs for the public token make the rule look optional.

**Impact.** The token is committed to source, cannot change per environment, and dev and staging traffic mix with production. A host literal is wrong for other regions or proxies, and a guessed key sends to no project. The wizard scanner blocks the edit and the agent burns time retrying.

**Rule location.**

- wizard (main): src/agent/commandments.ts (never write keys into source, mobile embeds the public token)
- src/agent/runner/harness/pi/runtime-notes.ts (NO\_LITERAL\_URL)
- src/agent/yara-hooks.ts (posthog\_hardcoded\_key abort copy)
- src/shared/utils/rules/universal.md
- src/programs/posthog-integration/index.ts (step: 'Reference these environment variables ... instead of hardcoding')
- [`context-mill: context/commandments.yaml#all`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: context/skills/integration-v2/init/description.md#Environment`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) variables
- [`context-mill: context/skills/audit/references/2-init.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/2-init.md) (hardcoded token = error)

**Sources.** [PostHog/wizard#222](https://github.com/PostHog/wizard/pull/222), [PostHog/wizard#263](https://github.com/PostHog/wizard/pull/263), [PostHog/wizard#751](https://github.com/PostHog/wizard/pull/751), [PostHog/wizard#962](https://github.com/PostHog/wizard/pull/962), [PostHog/context-mill#61](https://github.com/PostHog/context-mill/pull/61), [PostHog/context-mill#87](https://github.com/PostHog/context-mill/pull/87), [PostHog/context-mill#96](https://github.com/PostHog/context-mill/pull/96), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [PostHog/context-mill#208](https://github.com/PostHog/context-mill/pull/208), [PostHog/wizard#160](https://github.com/PostHog/wizard/pull/160), [PostHog/wizard#176](https://github.com/PostHog/wizard/pull/176), [PostHog/wizard#306](https://github.com/PostHog/wizard/pull/306), [PostHog/wizard#352](https://github.com/PostHog/wizard/pull/352), [PostHog/wizard#597](https://github.com/PostHog/wizard/pull/597), [PostHog/context-mill#290](https://github.com/PostHog/context-mill/pull/290)

**Frameworks.** `all`

**Wrong:**

```typescript
// lib/posthog.ts
posthog.init('phc_Zk3Qreal0token', {
  api_host: 'https://us.i.posthog.com',
})

# Python server
posthog = Posthog('phc_xxxxxxxxxxxx', host='https://us.i.posthog.com')
```

**Fixed:**

```typescript
check_env_keys({ keys: ['NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'NEXT_PUBLIC_POSTHOG_HOST'] })
set_env_values({ filePath: '.env.local', values: { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '<token>', NEXT_PUBLIC_POSTHOG_HOST: '<host>' } })
// instrumentation-client.ts
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
})
// runtime note: a literal PostHog URL or token in source is blocked (YARA posthog_hardcoded_key)
// exception: mobile release builds and static web snippets embed the public token
```

## Agent edits .env files with its own tools

**Problem.** Read then Write, sed and echo >> are how a generic agent edits any file, so it re-types every line of .env.local to add one key. LLMs are poor at copying long random strings exactly, and the damage is one character in an unrelated secret.

**Impact.** Silent. Existing secrets are clobbered or changed and found hours later in another service. Plain reads also pull real secrets into model context and the gateway.

**Rule location.**

- wizard (main): src/agent/agent-interface.ts (wizardCanUseTool .env deny, template carve-out via isTemplateEnvFileName)
- src/agent/tools/tools.ts (checkEnvKeys, mergeEnvValues)
- src/agent/tools/mcp.ts (check\_env\_keys, set\_env\_values)
- src/agent/runner/harness/pi/runtime-notes.ts (line 40, go straight to the env tools)
- [`context-mill: context/skills/integration/references/2-edit.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/2-edit.md)

**Sources.** [PostHog/wizard#136](https://github.com/PostHog/wizard/issues/136), [PostHog/wizard#159](https://github.com/PostHog/wizard/issues/159), [PostHog/wizard#263](https://github.com/PostHog/wizard/pull/263), [PostHog/wizard#793](https://github.com/PostHog/wizard/pull/793), [PostHog/wizard#1408](https://github.com/PostHog/wizard/pull/1408)

**Frameworks.** `all`

**Wrong:**

```text
Read  .env.local   # DATABASE_URL, SUPABASE_KEY, AWS_* now in model context
Write { file_path: ".env.local", content: <whole file re-typed> }
# SUPABASE_KEY comes back 1 character different
$ sed -i 's/KEY=.*/KEY=phc_.../' .env.local   # same risk from the shell
```

**Fixed:**

```javascript
check_env_keys({ keys: ['NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN'] })   // names only, never values
set_env_values({ filePath: '.env.local', values: {
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '<token>',
  NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com' } })
// mergeEnvValues touches only matching lines
// harness denies Read/Write/Edit (and Grep targeting) any .env* basename; .env.example/.sample/.template/.dist stay writable
```

## Existing env key assumed to be correct

**Problem.** Seeing the key name already in .env, or check\_env\_keys returning present, looks like the job is done, and skipping the write feels like respecting existing config.

**Impact.** Silent. A stale or placeholder token or host stays in place, so events go to the wrong project or region, or an invalid token disables analytics.

**Rule location.**

- wizard (main): src/programs/posthog-integration/index.ts (env var step: 'Don't assume the presence of keys means the value is up to date. Write the correct value each time.')
- src/agent/tools/tools.ts (mergeEnvValues)
- src/agent/tools/mcp.ts (set\_env\_values)

**Sources.** [PostHog/wizard#263](https://github.com/PostHog/wizard/pull/263)

**Frameworks.** `all`

**Wrong:**

```bash
grep -q POSTHOG .env.local && echo "already configured, skipping"
# or: check_env_keys -> NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: present -> skip write
# file still holds phc_old_or_placeholder
```

**Fixed:**

```javascript
// Don't assume the presence of keys means the value is up to date.
// Write the correct value each time.
set_env_values({ filePath: '.env.local', values: {
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '<current project token>',
  NEXT_PUBLIC_POSTHOG_HOST: '<host>' } })
```

## Browser code reads an unexposed env var

**Problem.** The agent names variables from memory (POSTHOG\_KEY, REACT\_APP\_\*) instead of following the bundler's public-prefix rule. Server-side reads work, and the wizard's own react-router config still returns REACT\_APP\_ names for a Vite-based router, so nothing looks wrong until the browser runs.

**Impact.** Silent. The bundler strips the variable or there is no process.env in the browser, the token is undefined, and init is skipped, sends nothing or throws.

**Rule location.**

- wizard (main): src/programs/frameworks/\*/\*-wizard-agent.ts (environment.getEnvVars)
- src/programs/framework-config.ts (EnvironmentConfig)
- src/shared/utils/environment.ts (detectEnvVarPrefix)
- src/programs/posthog-integration/index.ts (naming 'which you'll find in example code')
- [`context-mill: context/skills/integration-v2/init/description.md#Environment`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) variables ('Use the framework's public env-var convention'), example-apps/\*/.env.example

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [PostHog/context-mill#208](https://github.com/PostHog/context-mill/pull/208), [PostHog/context-mill#92](https://github.com/PostHog/context-mill/pull/92), [PostHog/context-mill#95](https://github.com/PostHog/context-mill/pull/95), [PostHog/wizard#160](https://github.com/PostHog/wizard/pull/160), [PostHog/wizard#176](https://github.com/PostHog/wizard/pull/176), [PostHog/wizard#214](https://github.com/PostHog/wizard/pull/214), [PostHog/wizard#248](https://github.com/PostHog/wizard/pull/248), [PostHog/wizard#260](https://github.com/PostHog/wizard/pull/260), [PostHog/wizard#261](https://github.com/PostHog/wizard/pull/261), [wizard@2f5e29d](https://github.com/PostHog/wizard/commit/2f5e29d6), [PostHog/wizard-workbench#3112](https://github.com/PostHog/wizard-workbench/pull/3112)

**Frameworks.** `nextjs`, `vite`, `react-vite`, `vue`, `nuxt`, `sveltekit`, `react-router`, `tanstack-router`, `tanstack-start`, `javascript_web`

**Wrong:**

```typescript
// lib/posthog.ts (Next.js), name from model memory
posthog.init(process.env.POSTHOG_KEY!, {
  api_host: process.env.POSTHOG_HOST,
})
// Vite app with CRA habits: process.env.REACT_APP_POSTHOG_KEY  (no process.env in the browser)
// Vue/Vite: import.meta.env.POSTHOG_KEY   (Vite only exposes VITE_*)
```

**Fixed:**

```typescript
environment: {
  getEnvVars: (apiKey, host) => ({
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: apiKey,
    NEXT_PUBLIC_POSTHOG_HOST: host,
  }),
}
// detectEnvVarPrefix(): next -> NEXT_PUBLIC_, react-scripts -> REACT_APP_, vite/TanStack -> VITE_PUBLIC_, SvelteKit -> PUBLIC_
// Nuxt: NUXT_PUBLIC_*   Vue: VITE_*   Angular (ngx-env): NG_APP_*
```

## Astro browser script reads a non-public env var

**Problem.** import.meta.env.POSTHOG\_PROJECT\_TOKEN works in Astro server code, so the agent reuses it in a client or is:inline script. Astro exposes only PUBLIC\_ variables to the client, inline scripts need define:vars to get values at all, and Astro returns undefined instead of erroring.

**Impact.** Silent. The token is undefined in the browser and the snippet never starts or runs with a blank key.

**Rule location.**

- [`context-mill: context/commandments.yaml#astro`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (is:inline, PUBLIC\_ prefix)
- `context-mill: example-apps/astro-*/src/components/posthog.astro` (define:vars pattern)
- [`context-mill: example-apps/astro-ssr/.env.example`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-ssr/.env.example) (PUBLIC\_ for client, unprefixed for server)
- `wizard: src/frameworks/astro/astro-wizard-agent.ts` (getEnvVars writes PUBLIC\_POSTHOG\_PROJECT\_TOKEN / PUBLIC\_POSTHOG\_HOST)

**Sources.** [PostHog/context-mill#73](https://github.com/PostHog/context-mill/pull/73), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [PostHog/context-mill#208](https://github.com/PostHog/context-mill/pull/208), [context-mill@6c1f00c](https://github.com/PostHog/context-mill/commit/6c1f00c9), [context-mill@13b9551](https://github.com/PostHog/context-mill/commit/13b95515)

**Frameworks.** `astro`

**Wrong:**

```html
# .env
POSTHOG_PROJECT_TOKEN=phc_xxx
<script is:inline>
  posthog.init(import.meta.env.POSTHOG_PROJECT_TOKEN, { api_host: process.env.POSTHOG_HOST })
</script>
```

**Fixed:**

```html
# .env
PUBLIC_POSTHOG_PROJECT_TOKEN=phc_xxx
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
<!-- posthog.astro -->
<script is:inline define:vars={{ apiKey: import.meta.env.PUBLIC_POSTHOG_PROJECT_TOKEN, apiHost: import.meta.env.PUBLIC_POSTHOG_HOST }}>
  posthog.init(apiKey, { api_host: apiHost })
</script>
```

## Angular reads env vars the CLI never exposes

**Problem.** The agent writes import.meta.env\['NG\_APP\_...'\] or process.env as it would in Vite. The stock Angular builder loads no .env at all, NG\_APP\_ only works with @ngx-env/builder installed, and only the example app's angular.json carried that fix.

**Impact.** Silent or a build error. The token is always undefined at runtime: in production the guard returns quietly and PostHog never sends events. In dev the guard throws and the page is blank.

**Rule location.**

- [`context-mill: context/commandments.yaml#angular`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (credentials in src/environments/environment.ts)
- [`context-mill: context/agents/error-tracking/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/init.md) ('Make the environment actually reachable', Angular on stock @angular/build)
- [`context-mill: example-apps/angular/angular.json`](https://github.com/PostHog/context-mill/blob/main/example-apps/angular/angular.json) (@ngx-env/builder), src/env.d.ts, src/environments/environment.ts, .env.example
- `wizard: src/frameworks/angular/angular-wizard-agent.ts` (getEnvVars writes NG\_APP\_\*)

**Sources.** [context-mill@bc5201a](https://github.com/PostHog/context-mill/commit/bc5201ae), [context-mill@e1414c4](https://github.com/PostHog/context-mill/commit/e1414c4c), [PostHog/context-mill#74](https://github.com/PostHog/context-mill/pull/74), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/wizard#264](https://github.com/PostHog/wizard/pull/264)

**Frameworks.** `angular`

**Wrong:**

```typescript
// stock @angular/build:application builder loads no .env
export const environment = {
  posthogKey: import.meta.env['NG_APP_POSTHOG_PROJECT_TOKEN'],  // undefined
  posthogHost: import.meta.env['NG_APP_POSTHOG_HOST'],
};
// or: posthog.init(process.env['POSTHOG_KEY']!, { api_host: '/ingest' })
```

**Fixed:**

```typescript
// Open the thing you read from and see the key defined, or don't read from it.
// Option A: angular.json "builder": "@ngx-env/builder:application" (+ :dev-server, :karma), src/env.d.ts
// Option B: src/environments/environment.ts (the public token ships in the bundle anyway)
export const environment = {
  posthogKey: 'phc_REAL_PROJECT_TOKEN',
  posthogHost: 'https://us.i.posthog.com',
};
// service: posthog.init(environment.posthogKey, { api_host: environment.posthogHost })
```

## React Native reads token from process.env

**Problem.** process.env works in Node and web bundlers, so the agent assumes Metro injects .env too. Bare React Native embeds env at build time through react-native-config plus native Gradle wiring, and Expo uses expo-constants extras, which agents mix up.

**Impact.** Silent. The token is undefined on device, PostHog never starts, and nothing crashes. Edits to .env need a native rebuild.

**Rule location.**

- [`context-mill: context/commandments.yaml#react-native`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #expo
- [`context-mill: example-apps/react-native/src/config/posthog.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-native/src/config/posthog.ts) android/app/build.gradle (line 7)
- [`context-mill: example-apps/expo/app.config.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/expo/app.config.js)

**Sources.** [PostHog/context-mill#75](https://github.com/PostHog/context-mill/pull/75), [PostHog/context-mill#249](https://github.com/PostHog/context-mill/pull/249), [context-mill@d2c2dda](https://github.com/PostHog/context-mill/commit/d2c2dda2d36aaaa380ad0a72cb188a7a70726e39)

**Frameworks.** `react-native`, `expo`

**Wrong:**

```typescript
const token = process.env.POSTHOG_PROJECT_TOKEN   // undefined in a bare RN/Expo bundle
export const posthog = new PostHog(token ?? '', {
  host: process.env.POSTHOG_HOST,
})
```

**Fixed:**

```typescript
// bare RN: embedded at build time
import Config from 'react-native-config'
const projectToken = Config.POSTHOG_PROJECT_TOKEN
// android/app/build.gradle
apply from: project(':react-native-config').projectDir.getPath() + "/dotenv.gradle"
// Expo (NOT react-native-config): app.config.js extra.posthogProjectToken
import Constants from 'expo-constants'
const token = Constants.expoConfig?.extra?.posthogProjectToken
```

## Token stored under legacy API key name

**Problem.** Older docs, training data, the SDK parameter apiKey and some docs pages call the public phc\_ token an 'API key' (POSTHOG\_KEY, POSTHOG\_API\_KEY, POSTHOG\_PROJECT\_API\_KEY), so the agent copies those names. Banning the name outright over-corrects, because renaming a project that already reads it breaks deploys.

**Impact.** Silent. Code reads a name the wizard, hosting upload or CI never sets, so the app starts with an empty token. Renaming a working project leaves every deploy step and CI secret that passes the old name starting the app with an empty token. People also confuse the token with the phx\_ personal API key.

**Rule location.**

- `wizard: src/lib/wizard-tools/tools.ts` (legacyKeyNameRefusal, used by src/lib/wizard-tools/mcp.ts and src/lib/agent/runner/harness/pi/tools.ts set\_env\_values), per-framework environment.getEnvVars
- [`context-mill: scripts/lint-env-naming.sh`](https://github.com/PostHog/context-mill/blob/main/scripts/lint-env-naming.sh) (DEPRECATED\_PATTERNS: POSTHOG\_API\_KEY, \_POSTHOG\_KEY, warns, never fails), example-apps/\*/.env.example, context/skills/posthog-best-practices/description.md, context/skills/mcp-analytics/description.md. Note: uploader keys such as POSTHOG\_API\_KEY for source-map plugins remain by design in context/skills/error-tracking-upload-source-maps

**Sources.** [PostHog/wizard#1185](https://github.com/PostHog/wizard/pull/1185), [PostHog/wizard#352](https://github.com/PostHog/wizard/pull/352), [wizard@632b80a](https://github.com/PostHog/wizard/commit/632b80aa), [PostHog/context-mill#95](https://github.com/PostHog/context-mill/pull/95), [PostHog/context-mill#208](https://github.com/PostHog/context-mill/pull/208), [PostHog/context-mill#344](https://github.com/PostHog/context-mill/pull/344), [context-mill@13b9551](https://github.com/PostHog/context-mill/commit/13b95515), [context-mill@6c1f00c](https://github.com/PostHog/context-mill/commit/6c1f00c9), [PostHog/posthog.com#19598](https://github.com/PostHog/posthog.com/pull/19598), `wizard: src/frameworks/elixir/elixir-wizard-agent.ts`

**Frameworks.** `all`, `php`, `ruby-on-rails`, `elixir`, `nextjs`, `astro`, `angular`, `android`, `expo`, `mcp-typescript-sdk`

**Wrong:**

```javascript
# fresh Next.js project
set_env_values({ filePath: '.env.local', values: { POSTHOG_KEY: 'phc_...' } })
posthog.init(process.env.POSTHOG_KEY)   // nothing else reads this name

# PHP example before #95
POSTHOG_API_KEY=phc_your_api_key_here
$apiKey = getenv('POSTHOG_API_KEY');
# other drift: NUXT_PUBLIC_POSTHOG_KEY, VITE_PUBLIC_POSTHOG_KEY, POSTHOG_PROJECT_API_KEY
```

**Fixed:**

```text
set_env_values({ values: { POSTHOG_KEY: '...' } })
-> Error: "POSTHOG_KEY" is not a valid PostHog env var name. Use the key name from
   your framework's integration guide (e.g. NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN).
   POSTHOG_KEY is accepted only when the project already reads it.

POSTHOG_PROJECT_TOKEN=phc_your_project_token_here
NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_...
# scripts/lint-env-naming.sh flags POSTHOG_API_KEY and _POSTHOG_KEY in examples
```

## New env keys missing from .env.example

**Problem.** The agent writes only the gitignored local file, because that is enough to make its own run work. Out of caution it sometimes adds .env.example or .env\* to .gitignore, hiding the one committed file that documents the keys.

**Impact.** Teammates, CI, fresh worktrees and deploy environments do not know which PostHog variables to set, so the integration runs silently unconfigured or the SDK warns.

**Rule location.**

- [`context-mill: context/skills/integration-v2/init/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) (document keys in .env.example, the only .env\* written directly)
- [`context-mill: context/skills/integration-v2/report/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/report/description.md) (env vars checklist item)
- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) (conditional checklist item)
- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (.env.example stays committed, ignore only .env)
- `wizard: src/lib/agent/agent-interface.ts` (template env files like .env.example stay writable)

**Sources.** [context-mill@08661e5](https://github.com/PostHog/context-mill/commit/08661e59), [PostHog/context-mill#174](https://github.com/PostHog/context-mill/pull/174), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [PostHog/context-mill#326](https://github.com/PostHog/context-mill/pull/326), [PostHog/wizard#447](https://github.com/PostHog/wizard/issues/447), [PostHog/wizard#595](https://github.com/PostHog/wizard/pull/595), [PostHog/wizard#1408](https://github.com/PostHog/wizard/pull/1408)

**Frameworks.** `all`

**Wrong:**

```bash
# .env.local (gitignored) gets:
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
# .env.example and bootstrap scripts: unchanged

# .gitignore (agent edit)
.env.example   # or .env*  -> hides the documentation
```

**Fixed:**

```bash
# .env.example (committed): real names, placeholder or empty values
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=
NEXT_PUBLIC_POSTHOG_HOST=
# .gitignore: ignore only .env, never .env.example
.env
# report checklist (only if env vars were added): the exact names are in
# .env.example, monorepo/bootstrap scripts and deploy envs
```

## Node start script exits when .env is missing

**Problem.** Plain Node does not load .env, so the agent adds node --env-file=.env to the start script as a clean, dependency-free fix. It works locally, but .env is gitignored and absent where hosts inject variables.

**Impact.** Deployed apps exit with code 9 before any app code runs (node: .env: not found), even though the host injects every variable.

**Rule location.**

- [`context-mill: context/agents/error-tracking/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/init.md) ('Make the environment actually reachable': when nothing loads .env, do not wire a loader, name it as a manual follow-up with dotenv or app environment as options)
- [`context-mill: context/agents/error-tracking/configure.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/configure.md) ('Never put a hard --env-file=.env on start')
- [`context-mill: context/agents/error-tracking/report.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/report.md) (Needs your attention block)

**Sources.** [PostHog/wizard#1329](https://github.com/PostHog/wizard/issues/1329), [PostHog/context-mill#408](https://github.com/PostHog/context-mill/pull/408), [PostHog/context-mill#377](https://github.com/PostHog/context-mill/pull/377), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `javascript-node`, `express`, `fastify`, `hono`, `koa`

**Wrong:**

```json
"scripts": {
  "start": "node --env-file=.env dist/index.js",
  "dev": "node --env-file=.env --watch index.js"
}
// $ npm start  ->  node: .env: not found (exit 9)
```

**Fixed:**

```text
"start": "node dist/index.js"   // start/dev left untouched, nothing installed
// report opens with:
// > ⚠️ **Needs your attention**
// > - Load `.env` in the app, or set `POSTHOG_API_KEY` in its environment.
// a loader already in the project (dotenv import, env-file flag) is left alone;
// dotenv's config() is a no-op when .env is missing
```

## Token written to .env that nothing loads

**Problem.** Next.js and Vite load .env automatically, so the agent assumes Express, Fastify, Hono, plain Ruby, go run, Spring or compiled binaries do too. The build is green, so nothing flags it.

**Impact.** The missing-variable guard throws at module load against an env file nothing reads, or the token is nil and the client silently sends nothing.

**Rule location.**

- [`context-mill: context/agents/error-tracking/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/init.md) ('Make the environment actually reachable') and configure.md (run script paragraph)
- [`context-mill: example-apps/ruby/Gemfile`](https://github.com/PostHog/context-mill/tree/main/example-apps/ruby/Gemfile) + todo.rb, example-apps/ruby-on-rails/Gemfile, example-apps/go|java-spring-boot|rust|elixir README.md
- [`context-mill: context/commandments.yaml#all`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (guard message)

**Sources.** [PostHog/wizard#1329](https://github.com/PostHog/wizard/issues/1329), [PostHog/context-mill#408](https://github.com/PostHog/context-mill/pull/408), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/wizard-workbench#4470](https://github.com/PostHog/wizard-workbench/pull/4470)

**Frameworks.** `express`, `fastify`, `hono`, `koa`, `ruby`, `ruby-on-rails`, `go`, `java`, `rust`, `elixir`

**Wrong:**

```typescript
// server.ts (Express), no dotenv import; "start": "node dist/server.js"
const key = process.env.POSTHOG_PROJECT_TOKEN
if (!key) throw new Error('POSTHOG_PROJECT_TOKEN required by PostHog is missing')

# todo.rb (plain Ruby): .env is never loaded
posthog = PostHog::Client.new(api_key: ENV['POSTHOG_PROJECT_TOKEN'])
```

**Fixed:**

```text
# Ruby: Gemfile gem 'dotenv', '~> 3.0' (Rails: 'dotenv-rails'); todo.rb: require 'dotenv/load'
# Go/Java/Rust/Elixir READMEs: copy .env.example to .env, then export the vars before run
# Node (error-tracking flow): never wire a loader or edit start/dev
#   (--env-file=.env exits 9 where .env is missing); name the gap in the handoff
#   with the variable names: load .env with dotenv, or set real environment variables
# Node app that already loads .env (dotenv import / env-file flag): leave it alone
```

## Gradle build crashes when .env is missing

**Problem.** The agent loads .env into Properties in build.gradle.kts to fill BuildConfig fields and does not check that the file exists. That file is always there on the author's machine.

**Impact.** Gradle sync and build throw FileNotFoundException on fresh clones and in CI, so missing PostHog config breaks the whole build.

**Rule location.** [`context-mill: context/commandments.yaml#all`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 10: keep build and boot working with no PostHog environment set)

**Sources.** [PostHog/wizard-workbench#3176](https://github.com/PostHog/wizard-workbench/pull/3176), [PostHog/wizard-workbench#4454](https://github.com/PostHog/wizard-workbench/pull/4454)

**Frameworks.** `android`

**Wrong:**

```kotlin
val env = Properties().apply {
    rootProject.file(".env").inputStream().use { load(it) }   // throws if .env is absent
}
buildConfigField("String", "POSTHOG_PROJECT_TOKEN", "\"${env["POSTHOG_PROJECT_TOKEN"]}\"")
```

**Fixed:**

```kotlin
val posthogProperties = Properties().apply {
    val envFile = project.file(".env")
    if (envFile.exists()) { envFile.inputStream().use(::load) }
}
fun posthogConfig(key: String): String =
    providers.environmentVariable(key).orNull ?: posthogProperties.getProperty(key).orEmpty()
```

## Dev and staging events land in production

**Problem.** The agent initialises PostHog with no condition and the production token, so localhost, preview and staging all send events. Nothing fails.

**Impact.** Event volume goes up, funnels and dashboards are polluted, and the bill rises. You only find it by breaking down $current\_url.

**Rule location.** [`context-mill: context/skills/audit-events/references/3-events-optimize.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-events/references/3-events-optimize.md) (Task C events-env-pollution, audit recommendation only, no integration commandment enforces it)

**Frameworks.** `all`

**Wrong:**

```typescript
posthog.init('phc_prod_xxx', { api_host: '/ingest' })  // runs on localhost, previews, staging
```

**Fixed:**

```typescript
if (process.env.NODE_ENV === 'production') {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, { api_host: '/ingest' })
}
// or a separate project token for dev/staging (audit recommendation, not an integration rule)
```

## PostHog starts during tests and CI

**Problem.** Test runners import the same app entry, and the agent does not think about them. The cost is quota, not a failure.

**Impact.** Every test run fires /flags requests and records synthetic replay sessions, which burns quota without anyone noticing.

**Rule location.**

- [`context-mill: context/skills/audit-feature-flags/references/3-feature-flags-optimize.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-feature-flags/references/3-feature-flags-optimize.md) (Task D ff-test-ci-gating)
- [`context-mill: context/skills/audit-session-replay/references/3-session-replay-optimize.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-session-replay/references/3-session-replay-optimize.md) (Task C replay-disabled-in-test-envs)

**Frameworks.** `javascript-web`, `react`, `next-js`, `node`

**Wrong:**

```typescript
// app entry, also imported by vitest and Playwright
posthog.init(key, { api_host: '/ingest' })
```

**Fixed:**

```typescript
if (process.env.NODE_ENV !== 'test' && !process.env.CI) {
  posthog.init(key, opts)
}
// or in test/CI: advanced_disable_feature_flags: true, disable_session_recording: true
```

## Elixir test suite sends real events

**Problem.** The agent configures PostHog once in config.exs for all environments and adds no test-environment setting. Nothing fails, so the leak is invisible.

**Impact.** Silent. mix test ships fake events to the live PostHog project and pollutes data.

**Rule location.**

- [`context-mill: context/commandments.yaml#elixir`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 125)
- `wizard: src/frameworks/elixir/elixir-wizard-agent.ts` (line 74, prompt context). Example app example-apps/elixir has no config/test.exs

**Sources.** [PostHog/context-mill#154](https://github.com/PostHog/context-mill/pull/154), [PostHog/wizard#946](https://github.com/PostHog/wizard/pull/946), [wizard@b8b8aa6](https://github.com/PostHog/wizard/commit/b8b8aa62)

**Frameworks.** `elixir`, `phoenix`

**Wrong:**

```elixir
# config/config.exs only; config/test.exs has no :posthog config
config :posthog, enable: true, in_app_otp_apps: [:my_app]
# mix test => PostHog.capture/2 ships events to the live project
```

**Fixed:**

```elixir
# config/test.exs
config :posthog, test_mode: true   # events are dropped instead of sent
```

## Elixir reads env in config.exs, not runtime.exs

**Problem.** config/config.exs is the familiar place for app config, and System.get\_env there works in dev. It runs at compile time, so releases bake in the build machine's value, and Phoenix does not load .env on its own.

**Impact.** Silent. A release ships with nil or the wrong token, so the SDK is disabled or events go nowhere.

**Rule location.**

- [`context-mill: example-apps/elixir/config/runtime.exs`](https://github.com/PostHog/context-mill/blob/main/example-apps/elixir/config/runtime.exs) and config/config.exs
- [`context-mill: example-apps/elixir/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/elixir/README.md) (export vars)
- [`context-mill: context/commandments.yaml#elixir`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 124, 'environment or runtime config')

**Sources.** [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268)

**Frameworks.** `elixir`, `phoenix`

**Wrong:**

```elixir
# config/config.exs  (evaluated at compile time)
config :posthog,
  api_key: System.get_env("POSTHOG_PROJECT_TOKEN"),
  api_host: System.get_env("POSTHOG_HOST")
```

**Fixed:**

```elixir
# config/runtime.exs  (runs at boot)
config :posthog,
  api_key: System.get_env("POSTHOG_PROJECT_TOKEN"),
  api_host: System.get_env("POSTHOG_HOST") || "https://us.i.posthog.com"
# config/config.exs keeps only: enable: true, in_app_otp_apps: [:my_app]
```

## Placeholder from .env.example accepted as real token

**Problem.** Copying .env.example to .env is the normal setup step, and a truthiness check passes for phc\_your\_project\_token\_here. The agent guards against unset, not against the template value.

**Impact.** Events go to an invalid token and ingestion rejects them while the app shows no error.

**Rule location.**

- [`context-mill: example-apps/php/todo.php#initializePostHog`](https://github.com/PostHog/context-mill/blob/main/example-apps/php/todo.php) (line ~50)
- [`context-mill: example-apps/react-native/src/config/posthog.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-native/src/config/posthog.ts) (line 8, 31)
- [`context-mill: example-apps/expo/src/config/posthog.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/expo/src/config/posthog.ts) (line 8, 42)

**Sources.** [PostHog/context-mill#136](https://github.com/PostHog/context-mill/pull/136), [PostHog/context-mill#75](https://github.com/PostHog/context-mill/pull/75)

**Frameworks.** `php`, `react-native`, `expo`

**Wrong:**

```php
$projectToken = getenv('POSTHOG_PROJECT_TOKEN'); // 'phc_your_project_token_here'
PostHog::init($projectToken, ['host' => $host]);
```

**Fixed:**

```php
$projectToken = getenv('POSTHOG_PROJECT_TOKEN');
if (!$projectToken || str_starts_with($projectToken, 'phc_your_')) {
    echo "WARNING: PostHog not configured (POSTHOG_PROJECT_TOKEN not set)\n";
    return false;
}
// React Native: disabled: !isPostHogConfigured, where
// isPostHogConfigured = projectToken && projectToken !== 'phc_your_project_token_here'
```

## Key in .env.example treated as configured

**Problem.** A grep for the key finds it in the committed template, so the agent concludes it is set, or writes the real secret into that template because it looks like an env file. Adding a tracked file to .gitignore afterwards changes nothing.

**Impact.** Credential setup is skipped and the app has no key, or the real secret is committed and published with the repository.

**Rule location.**

- `wizard: src/utils/env-scan.ts` (isTemplateEnvFileName)
- src/lib/wizard-tools/tools.ts (checkEnvKeys, templateEnvWriteRefusal)

**Sources.** [PostHog/wizard#1144](https://github.com/PostHog/wizard/pull/1144)

**Frameworks.** `all`

**Wrong:**

```javascript
# .env.example (committed)
OPENAI_API_KEY=
# agent: 'key already present' -> skips collecting it
# or writes the real secret into the template:
set_env_values({ filePath: '.env.example', values: { OPENAI_API_KEY: 'sk-live-...' } })
```

**Fixed:**

```javascript
check_env_keys -> { "OPENAI_API_KEY": { "status": "missing", "foundIn": [".env.example"] } }
// "present" only if a non-template env file sets it
set_env_values({ filePath: '.env.example', ... })
-> Error: "...a credential written there would be published with the repository.
   Write to .env or .env.local"
// refuses .env.example / .sample / .template / .dist
```

## Env write duplicates an export KEY line

**Problem.** A naive updater matches ^KEY= and appends when no match is found, missing lines written as `export KEY=...`. Keys are also put into regexes unescaped.

**Impact.** Two declarations of one key. The winner depends on the dotenv loader, so the app can keep the stale or wrong token.

**Rule location.** `wizard: src/lib/wizard-tools/tools.ts` (mergeEnvValues, escapeRegExp)

**Sources.** [PostHog/wizard#1144](https://github.com/PostHog/wizard/pull/1144)

**Frameworks.** `all`

**Wrong:**

```shell
# before
export POSTHOG_HOST=https://eu.i.posthog.com
# after an append-only write
export POSTHOG_HOST=https://eu.i.posthog.com
POSTHOG_HOST=https://us.i.posthog.com
```

**Fixed:**

```typescript
const regex = new RegExp(
  `^(\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=).*$`, 'm');
result = result.replace(regex, `$1${value}`); // keeps `export `, one declaration
```

## Env file written to a duplicated subdirectory

**Problem.** In a monorepo the agent passes a repo-root-relative path while the wizard already runs inside the subproject, and a mkdir -p style writer happily creates the missing directories.

**Impact.** A stray apps/web/apps/web/.env appears and the real app never sees the token. The write itself reports success.

**Rule location.**

- `wizard: src/lib/wizard-tools/mcp.ts` (set\_env\_values parent-dir check)
- src/lib/wizard-tools/tools.ts (resolveEnvPath, ENV\_FILE\_PATH\_DESCRIPTION)
- src/lib/programs/error-tracking-upload-source-maps/prompt.ts (envFilePathGuidance)

**Sources.** [PostHog/wizard#871](https://github.com/PostHog/wizard/pull/871), [wizard@4430ed2](https://github.com/PostHog/wizard/commit/4430ed29)

**Frameworks.** `all`

**Wrong:**

```javascript
// wizard cwd is <repo>/apps/web
set_env_values({ filePath: 'apps/web/.env', values: { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '...' } })
// -> creates <repo>/apps/web/apps/web/.env
```

**Fixed:**

```text
Error: parent directory does not exist: "apps/web". filePath is resolved against
the wizard working directory: pass ".env" for a file there, or
"<subproject>/.env" for an existing nested project.
// resolveEnvPath also rejects paths outside the working directory
// then ensureGitignoreCoverage(workingDirectory, '.env')
```

## Existing init reads a variable nobody defined

**Problem.** An init call plus the SDK in the manifest looks like a finished integration, so the agent leaves it alone without checking the variable exists.

**Impact.** The client is built from an empty string. The app starts, every capture returns, and no event ever arrives.

**Rule location.**

- [`context-mill: context/agents/error-tracking/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/init.md) ('An existing init still needs its variable defined')
- [`context-mill: context/agents/error-tracking/setup-error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/setup-error-tracking.md) (step 1, 'Integrated means the init runs')

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `all`

**Wrong:**

```javascript
// init found, package listed -> "already integrated", skip
posthog.init(process.env.POSTHOG_KEY ?? '', { api_host })
// .env has no POSTHOG_KEY
```

**Fixed:**

```javascript
// check_env_keys for the EXACT name the init reads
// present -> leave alone and say so
// absent  -> set_env_values({ POSTHOG_KEY: ... }) under the name the code
//            already reads (never rename the code), and document it in .env.example
```

## Deploy step does not pass the token

**Problem.** The agent matches names between code and .env but never opens docker run, compose, systemd or PaaS settings. Those start steps predate PostHog and either pass an old name or none at all, even when the agent adds the new release ID there.

**Impact.** Silent. In production the init guard returns quietly. The process boots, serves traffic and reports nothing.

**Rule location.**

- [`context-mill: context/agents/error-tracking/wire-ci.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/wire-ci.md) ('The runtime boundary has names too')
- [`context-mill: context/agents/error-tracking/link-releases.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/link-releases.md) ('The last hop decides it')

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `docker`, `compose`, `systemd`, `paas`, `python`, `ruby`, `php`

**Wrong:**

```bash
# pre-existing deploy step, app source reads POSTHOG_PROJECT_TOKEN
docker run -e POSTHOG_KEY=$KEY app

# or the start step passes the release ID but not the token and host
docker run -d \
  -e DATABASE_URL="$DATABASE_URL" \
  -e POSTHOG_RELEASE_ID="$ID" \
  app:latest
```

**Fixed:**

```bash
# pass the names the app's source reads, same mechanism as its other variables
docker run -d -e DATABASE_URL="$DATABASE_URL" \
  -e POSTHOG_API_KEY="$POSTHOG_API_KEY" -e POSTHOG_HOST="$POSTHOG_HOST" \
  -e POSTHOG_RELEASE_ID="$ID" app:latest
# change the deploy step, not the code; name any new secret in the handoff
```

## Too much guard code around a simple bootstrap

**Problem.** Once the fail-loudly config rule existed, agents applied it everywhere. They wrapped a few-line docs bootstrap in an init function, a module global and a custom raise, even where a direct os.environ lookup already fails loudly.

**Impact.** Needless restructuring, extra failure surface and diff noise in the user's LLM client setup that drifts from the documented pattern.

**Rule location.**

- [`context-mill: context/commandments.yaml#ai_observability`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (Swap the client)

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319)

**Frameworks.** `python`, `node`, `openai`

**Wrong:**

```python
_posthog = None
def init_posthog():
    global _posthog
    key = os.environ.get('POSTHOG_API_KEY')
    if not key:
        raise RuntimeError('POSTHOG_API_KEY is not set')
    _posthog = Posthog(key, host=os.environ['POSTHOG_HOST'])
```

**Fixed:**

```python
# module level, next to the existing vendor client
posthog = Posthog(os.environ['POSTHOG_API_KEY'], host=os.environ['POSTHOG_HOST'])
client = OpenAI(posthog_client=posthog)
# unset key -> KeyError, already the loud failure. No guard branch.
```

## Env vars set locally, missing in production

**Problem.** Agents write .env.local and stop. Local dev works so nothing shows the production deploy has no key.

**Impact.** Vercel production builds have no token, so init is skipped and production events are silently missing.

**Rule location.**

- wizard (main): src/programs/posthog-integration/index.ts (postRun, uploadToHosting)
- src/programs/posthog-integration/upload-environment-variables/upload-step.ts and providers/vercel.ts
- uploadToHosting: true in nextjs, nuxt, astro, svelte, vue wizard-agent.ts

**Sources.** [PostHog/wizard#32](https://github.com/PostHog/wizard/pull/32), [PostHog/wizard#160](https://github.com/PostHog/wizard/pull/160), [PostHog/wizard#176](https://github.com/PostHog/wizard/pull/176)

**Frameworks.** `nextjs`, `nuxt`, `vue`, `astro`, `svelte`

**Wrong:**

```bash
# .env.local only
NEXT_PUBLIC_POSTHOG_KEY=phc_...
# production (Vercel) project has no such variable
```

**Fixed:**

```typescript
environment: { uploadToHosting: true, getEnvVars }
// postRun, after the agent run:
if (config.environment.uploadToHosting) {
  uploaded = await uploadEnvironmentVariablesStep(envVars,
    { integration, installDir: sess.installDir, runner })
}
// detects Vercel CLI + linked + logged in; uploads to production, preview, development
```

## Trailing newline corrupts uploaded env value

**Problem.** Piping a value into 'vercel env add' echo-style appends a newline that the CLI stores verbatim. Nothing errors.

**Impact.** The deployed token or host ends in '\\n', so requests use a malformed value and fail silently.

**Rule location.** wizard (main): src/programs/posthog-integration/upload-environment-variables/providers/vercel.ts (uploadEnvironmentVariable)

**Sources.** [PostHog/wizard#36](https://github.com/PostHog/wizard/pull/36)

**Frameworks.** `nextjs`, `nuxt`, `vue`, `astro`, `svelte`

**Wrong:**

```typescript
proc.stdin.write(value + '\n') // vercel env add KEY production
// stored value: "phc_abc123\n"
```

**Fixed:**

```typescript
proc.stdin.write(value) // exact value, no trailing newline
proc.stdin.end()
// spawn('vercel', ['env', 'add', key, environment]) for production, preview, development
```

## A .env directory crashes the key lookup

**Problem.** existsSync returns true for directories, and Python virtualenvs are often named .env, so 'exists then read' throws.

**Impact.** Uncaught EISDIR aborts the API-key and env-key lookup before any integration work.

**Rule location.**

- [`wizard: src/shared/utils/env-api-key.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/utils/env-api-key.ts)
- src/shared/utils/bounded-fs.ts (readProjectFile)
- src/agent/tools/tools.ts (readSingleEnvFile)

**Sources.** [PostHog/wizard#721](https://github.com/PostHog/wizard/pull/721)

**Frameworks.** `python`, `django`, `flask`, `fastapi`

**Wrong:**

```typescript
const envPath = path.join(process.cwd(), envFile);
if (fs.existsSync(envPath)) {                      // true for a directory too
  const content = fs.readFileSync(envPath, 'utf8'); // EISDIR
}
```

**Fixed:**

```typescript
// null when missing, oversized or a directory (a Python virtualenv)
const content = readProjectFile(path.join(process.cwd(), envFile));
const match = content?.match(/^POSTHOG_PERSONAL_API_KEY=(.+)$/m);
if (match) return match[1].trim();
// check_env_keys on a directory reports 'missing' instead of throwing
```

## Trailing-slash install dir blocks env writes

**Problem.** Harness path guards compared a resolved path against the raw working-directory string, so a trailing slash or relative root failed the prefix check.

**Impact.** With --install-dir=my-app/ every env write, even plain .env, was rejected as path traversal and the run aborted.

**Rule location.**

- [`wizard: src/agent/tools/tools.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/tools/tools.ts) (resolveEnvPath)
- src/agent/runner/harness/pi/security.ts (isDeletableProjectFile, canonicalRoot)
- installDir resolved with path.resolve in src/cli/runners/run-wizard.ts and run-non-interactive.ts

**Sources.** [PostHog/wizard#1259](https://github.com/PostHog/wizard/pull/1259)

**Frameworks.** `all`

**Wrong:**

```typescript
const resolved = path.resolve(workingDirectory, filePath);
if (!resolved.startsWith(workingDirectory + path.sep) &&
    resolved !== workingDirectory) {
  throw new Error('Path traversal rejected');
}
```

**Fixed:**

```typescript
// canonicalize the root first
const root = path.resolve(workingDirectory);
const resolved = path.resolve(root, filePath);
if (!resolved.startsWith(root + path.sep) && resolved !== root) {
  throw new Error(`Path traversal rejected: "${filePath}" resolves outside working directory "${root}"`);
}
```

## Project Claude settings override agent credentials

**Problem.** A project's .claude/settings.json or managed settings can pin ANTHROPIC\_BASE\_URL, ANTHROPIC\_AUTH\_TOKEN or apiKeyHelper, which outrank the credentials the harness injects.

**Impact.** Every model call returns 401 from the gateway and the run dies before writing any code.

**Rule location.**

- wizard (main): src/shared/claude-settings.ts (BLOCKING\_ENV\_KEYS, backupAndFixClaudeSettings, restoreClaudeSettings, classifySettingsConflicts)
- src/shared/agent-env-isolation.ts
- restore called in src/programs/run-program.ts

**Sources.** [PostHog/wizard#324](https://github.com/PostHog/wizard/pull/324), [PostHog/wizard#343](https://github.com/PostHog/wizard/pull/343), [PostHog/wizard#345](https://github.com/PostHog/wizard/pull/345), [PostHog/wizard#615](https://github.com/PostHog/wizard/pull/615), [PostHog/wizard#613](https://github.com/PostHog/wizard/issues/613), [PostHog/wizard#598](https://github.com/PostHog/wizard/issues/598), [PostHog/wizard#744](https://github.com/PostHog/wizard/pull/744), [PostHog/wizard#614](https://github.com/PostHog/wizard/pull/614), [PostHog/wizard#602](https://github.com/PostHog/wizard/issues/602), [PostHog/wizard#1180](https://github.com/PostHog/wizard/pull/1180), [PostHog/wizard#1408](https://github.com/PostHog/wizard/pull/1408), [PostHog/wizard#700](https://github.com/PostHog/wizard/pull/700)

**Frameworks.** `all`

**Wrong:**

```json
// <project>/.claude/settings.json
{
  "env": { "ANTHROPIC_BASE_URL": "https://api.anthropic.com" },
  "apiKeyHelper": "echo sk-ant-FAKE-from-project"
}
```

**Fixed:**

```typescript
const BLOCKING_ENV_KEYS = ['ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN', ...BLOCKED_AGENT_ENV_KEYS];
const BLOCKING_SETTINGS_KEYS = ['apiKeyHelper'];
// project settings.json has a blocking key -> copy to settings.json.wizard-backup, remove original
if (settings.backedUp) restoreClaudeSettings(installDir); // run-program.ts, on finish
// org-managed (MDM) file is not writable -> fail closed
```

## OAuth silently picks the wrong project

**Problem.** Taking the first granted team from the token is the simple path, and drops the --project-id the caller asked for.

**Impact.** The wrong project's token is written and events are silently captured into it.

**Rule location.**

- [`wizard: src/shared/utils/project-resolution.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/utils/project-resolution.ts) (resolveGrantedProject)
- src/tui/auth/project-data.ts

**Sources.** [PostHog/wizard#743](https://github.com/PostHog/wizard/pull/743)

**Frameworks.** `all`

**Wrong:**

```typescript
const projectId = tokenResponse.scoped_teams?.[0]; // whatever was ticked on consent
```

**Fixed:**

```typescript
const resolution = resolveGrantedProject(options.projectId, tokenResponse.scoped_teams);
if (!resolution.ok) abort(`You authorized project ${resolution.granted}, but setup is targeting project ${resolution.requested} (from --project-id).`);
```

## First project's token used without asking

**Problem.** The MCP projects-get call returns a list and agents take element zero. Nothing shows the org has Production and Staging.

**Impact.** Events land in the wrong PostHog project.

**Rule location.** `context-mill: context/skills/omnibus/instrument-*/description.md` (STEP 6, or STEP 9 in product-analytics)

**Sources.** [PostHog/context-mill#116](https://github.com/PostHog/context-mill/pull/116)

**Frameworks.** `all`

**Wrong:**

```text
projects-get -> [{ name: 'Production', api_token: 'phc_a...' },
                 { name: 'Staging', api_token: 'phc_b...' }]
// agent writes projects[0].api_token to .env without asking
```

**Fixed:**

```markdown
If multiple projects are returned, ask the user which project to use.
If the MCP server is not connected or not authenticated,
ask the user for their PostHog project token instead.
```

## Env step depends on a missing tool server

**Problem.** The skill told agents to use an env-file-tools MCP server that is never connected outside the wizard, so they skipped the step or hardcoded the key.

**Impact.** PostHog env vars were never written for any user of the instrument skills.

**Rule location.** `context-mill: context/skills/omnibus/instrument-*/description.md` (Set up environment variables step: STEP 6, or STEP 9 in product-analytics)

**Sources.** [PostHog/context-mill#116](https://github.com/PostHog/context-mill/pull/116)

**Frameworks.** `all`

**Wrong:**

```markdown
STEP 6: Set up environment variables.
  - If an env-file-tools MCP server is connected, use check_env_keys
    to see which keys already exist, then use set_env_values to
    create or update the PostHog API key and host.
```

**Fixed:**

```markdown
- If valid PostHog env vars already exist, skip this step.
- Else call the PostHog MCP server's `projects-get` tool for the
  project's `api_token`; if MCP is not connected, ask the user for it.
- Host: `region` US -> https://us.i.posthog.com, EU -> https://eu.i.posthog.com;
  if unknown, ask. Do not assume US Cloud.
- Write them to .env.local (Next.js) or .env using the framework's naming.
```

## Missing-key error text flagged as malicious

**Problem.** The natural message 'you can safely remove this error' reads to a security scanner as an instruction to remove PostHog, and the agent may follow it literally.

**Impact.** Writes get blocked or flagged, or the agent strips the env-var guard.

**Rule location.** [`context-mill: context/commandments.yaml#all`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (the 'A missing PostHog configuration must never break the app' commandment carries the exact message)

**Sources.** [PostHog/context-mill#260](https://github.com/PostHog/context-mill/pull/260), [context-mill@4c92a21](https://github.com/PostHog/context-mill/commit/4c92a21d), [PostHog/context-mill#218](https://github.com/PostHog/context-mill/pull/218)

**Frameworks.** `all`

**Wrong:**

```js
throw new Error(`POSTHOG_KEY variable required by PostHog is missing or un-configured,
this causes events to be silently missed.
You can safely remove this error once you configure POSTHOG_KEY variable`)
```

**Fixed:**

```js
throw new Error(`POSTHOG_KEY variable required by PostHog is missing or un-configured,
this causes events to be silently missed.
This error stops appearing once POSTHOG_KEY is configured`)
```

## MCP auth header relies on variable expansion

**Problem.** Keeping the token in env and referencing ${VAR} is the common config pattern, but Claude Code does not expand it in several config locations.

**Impact.** The literal string is sent and the MCP server fails with 'Missing environment variables: POSTHOG\_AUTH\_HEADER'.

**Rule location.** `wizard: src/steps/add-mcp-server-to-clients/clients/claude-code.ts` (args built for `claude mcp add`), src/steps/add-mcp-server-to-clients/defaults.ts (buildMCPUrl, getNativeHTTPServerConfig)

**Sources.** [PostHog/wizard#169](https://github.com/PostHog/wizard/pull/169), [PostHog/wizard#191](https://github.com/PostHog/wizard/pull/191)

**Frameworks.** `claude-code`, `cursor`, `vs-code`, `zed`, `opencode`

**Wrong:**

```json
{"posthog": {"command": "npx",
  "args": ["-y", "mcp-remote@latest", "https://mcp.posthog.com/sse",
    "--header", "Authorization:${POSTHOG_AUTH_HEADER}"],
  "env": {"POSTHOG_AUTH_HEADER": "Bearer phx_..."}}}
```

**Fixed:**

```bash
claude mcp add --transport http --scope user posthog https://mcp.posthog.com/mcp \
  --header "Authorization: Bearer <token>"
# native http headers; no mcp-remote, no ${VAR}
```

## Workers key read from process.env at module scope

**Problem.** Node habits read the key from process.env when the module loads, but on Cloudflare Workers bindings arrive on the request's env. The isolate can also end before a batched send.

**Impact.** An empty project token where process.env is not populated, so nothing is captured, plus events lost when the isolate ends before the batch is sent.

**Rule location.**

- [`context-mill: context/docs.yaml#cloudflare-workers`](https://github.com/PostHog/context-mill/blob/main/context/docs.yaml) (fetches posthog.com/docs/libraries/cloudflare-workers.md)
- [`wizard: src/programs/cloudflare-detection.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/cloudflare-detection.ts) (detector exists on main, not called)

**Sources.** [PostHog/wizard#370](https://github.com/PostHog/wizard/pull/370), [wizard@e719244](https://github.com/PostHog/wizard/commit/e719244d), [PostHog/wizard#1121](https://github.com/PostHog/wizard/issues/1121)

**Frameworks.** `cloudflare-workers`, `react-router`, `astro`, `sveltekit`, `nextjs`

**Wrong:**

```typescript
const ph = new PostHog(process.env.POSTHOG_PROJECT_TOKEN!)  // bindings are on env
ph.capture({ distinctId, event: 'order_created' })           // isolate ends first
```

**Fixed:**

```typescript
export function createPostHogClient(env) {
  return new PostHog(env.POSTHOG_PROJECT_TOKEN, {
    host: env.POSTHOG_HOST,
    flushAt: 1,        // Workers can end before a batch is sent
    flushInterval: 0,
  })
}
// in fetch(request, env, ctx): ctx.waitUntil(posthog.captureImmediate({ distinctId, event }))
```

## .env.example added to .gitignore

**Problem.** An over-cautious agent protecting secrets ignores every .env\* file, including the example file that holds no secrets.

**Impact.** The env-var documentation the step just wrote is hidden from version control, so the next developer never sees it.

**Rule location.**

- [`context-mill: context/skills/integration-v2/init/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) ('This file is committed')
- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md)

**Sources.** [PostHog/context-mill#326](https://github.com/PostHog/context-mill/pull/326)

**Frameworks.** `all`

**Wrong:**

```diff
# .gitignore
+.env
+.env.example
```

**Fixed:**

```diff
# .gitignore
+.env
# .env.example stays committed: it is documentation
```

## Missing-token guard repeated at every capture

**Problem.** Told not to crash when the token is missing, the agent over-corrects and wraps each capture call in its own token check instead of guarding init once.

**Impact.** Copy-pasted guards on every call site that drift out of sync. The Flutter rubric item Q1 (no guard duplication) failed with 7 guards at baseline.

**Rule location.**

- `wizard-workbench: docs/flutter-integration-rubric.md` Q1 (added in 84dc3a3d5, removed in 54ecc1ad6) and services/wizard-ci/score-flutter.sh (GUARDS count). context-mill: context/commandments.yaml line 10 currently says 'guard init and capture behind their presence', which conflicts with this snippet
- the specific 'init once, capture bare' prose is not in current text

**Sources.** [wizard-workbench@84dc3a3](https://github.com/PostHog/wizard-workbench/commit/84dc3a3d5), [wizard-workbench@54ecc1a](https://github.com/PostHog/wizard-workbench/commit/54ecc1ad6), [PostHog/wizard-workbench#3503](https://github.com/PostHog/wizard-workbench/pull/3503)

**Frameworks.** `flutter`

**Wrong:**

```dart
if (projectToken.isNotEmpty) {
  Posthog().capture(eventName: 'file_sent');
}   // repeated at 7 call sites
```

**Fixed:**

```dart
// init is guarded once where the SDK is set up; capture sites stay bare
Posthog().capture(eventName: 'file_sent');
```
