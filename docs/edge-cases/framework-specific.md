# Framework-specific wiring missed

99 cases. Part of the [edge case catalogue](../edge-cases.md).

## react-native-config used in an Expo app

**Problem.** Agents follow bare React Native guidance (react-native-config) in an Expo app. It needs native linking that managed Expo lacks. Before PR 249 the merged commandments for Expo said both 'use react-native-config' and 'NOT react-native-config'.

**Impact.** The token resolves undefined and events are silently missed. Behaviour varies run to run.

**Rule location.**

- [`context-mill: context/commandments.yaml#expo`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (and #react-native for the bare-RN rule)
- [`context-mill: example-apps/expo/app.config.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/expo/app.config.js) example-apps/expo/src/config/posthog.ts

**Sources.** [PostHog/context-mill#249](https://github.com/PostHog/context-mill/pull/249)

**Frameworks.** `expo`, `react-native`

**Wrong:**

```typescript
import Config from "react-native-config";
const projectToken = Config.POSTHOG_PROJECT_TOKEN;
const host = Config.POSTHOG_HOST;
```

**Fixed:**

```javascript
// app.config.js
extra: {
  posthogProjectToken: process.env.POSTHOG_PROJECT_TOKEN,
  posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
},
// src/config/posthog.ts
const projectToken = Constants.expoConfig?.extra?.posthogProjectToken as string | undefined
```

## process.env used for token on Cloudflare Workers

**Problem.** Agents write Node-server code with process.env at module top level. On Workers, env is a handler binding and the accessor differs per framework. Process.env is only populated with nodejs\_compat (compat date 2025-04-01+) and, in Nuxt, only inside event handlers.

**Impact.** Without nodejs\_compat or inside top-level scope, the client is built with an undefined token, so it throws or silently drops events.

**Rule location.**

- [`context-mill: context/docs.yaml#cloudflare-workers`](https://github.com/PostHog/context-mill/blob/main/context/docs.yaml) (ingests https://posthog.com/docs/libraries/cloudflare-workers.md, 'Environment variables' section, release asset)
- `wizard: src/lib/cloudflare-detection.ts`

**Sources.** [PostHog/wizard#370](https://github.com/PostHog/wizard/pull/370), [PostHog/context-mill#104](https://github.com/PostHog/context-mill/pull/104), [posthog.com/docs/libraries/cloudflare-workers](https://posthog.com/docs/libraries/cloudflare-workers)

**Frameworks.** `cloudflare-workers`, `hono`, `react-router`, `sveltekit`, `astro`, `nuxt`

**Wrong:**

```typescript
import { PostHog } from 'posthog-node'

export const posthog = new PostHog(process.env.POSTHOG_PROJECT_TOKEN!, {
  host: process.env.POSTHOG_HOST,
})
```

**Fixed:**

```typescript
// token comes from the handler's env binding
export function createPostHogClient(env) {
  return new PostHog(env.POSTHOG_PROJECT_TOKEN, { host: env.POSTHOG_HOST, flushAt: 1, flushInterval: 0 })
}
// React Router 7: context.cloudflare.env  SvelteKit: platform.env
// Astro 6+: import { env } from 'cloudflare:workers'  Nuxt: process.env only inside handlers
```

## WordPress token hardcoded or in custom .env

**Problem.** Agents either paste the token into plugin source or port the Node habit of a .env file with a hand-rolled parser, which WordPress sites do not use.

**Impact.** A distributable plugin leaks one site's token, or config breaks on hosts without that .env and sits where admins never look.

**Rule location.**

- [`context-mill: context/commandments.yaml#wordpress`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: example-apps/wordpress/posthog-example/posthog-example.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/wordpress/posthog-example/posthog-example.php)

**Sources.** [PostHog/context-mill#279](https://github.com/PostHog/context-mill/pull/279), [context-mill@6ad0ca0](https://github.com/PostHog/context-mill/commit/6ad0ca08)

**Frameworks.** `wordpress`, `php`

**Wrong:**

```php
const POSTHOG_TOKEN = 'phc_realtoken';
// or: ship a plugin-local .env plus a custom parser
$env = parse_env(__DIR__ . '/.env');
```

**Fixed:**

```php
// wp-config.php, next to DB_PASSWORD
define('POSTHOG_PROJECT_TOKEN', 'phc_...');
define('POSTHOG_HOST', 'https://us.i.posthog.com');
// plugin
function posthog_example_token(): string {
    return defined('POSTHOG_PROJECT_TOKEN') ? (string) POSTHOG_PROJECT_TOKEN : '';
}
```

## Svelte 4 syntax written into a runes app

**Problem.** Training data is mostly Svelte 4, so agents write export let and on:click, and a JS build may not catch rune misuse, so the agent finishes without Svelte's own validator.

**Impact.** Components build but misbehave under runes, or the compiler rejects them.

**Rule location.**

- [`context-mill: context/commandments.yaml#sveltekit`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 240)
- `wizard: src/frameworks/svelte/svelte-wizard-agent.ts` (additionalMcpServers.svelte = https://mcp.svelte.dev/mcp)

**Sources.** [PostHog/wizard#261](https://github.com/PostHog/wizard/pull/261)

**Frameworks.** `sveltekit`

**Wrong:**

```svelte
<script>
  export let user;
  $: greeting = 'Hi ' + user.name;
</script>
<button on:click={consider}>
<!-- finishes without any Svelte validation step -->
```

**Fixed:**

```svelte
<script>
  let { user } = $props();
  let greeting = $derived('Hi ' + user.name);
</script>
<button onclick={consider}>
<!-- use Svelte MCP (list-sections, get-documentation); always run
     svelte-autofixer on every new or modified .svelte file before finishing -->
```

## Flutter PostHog mock rejected at runtime

**Problem.** The standard Dart pattern is a mockito/mocktail mock that implements the interface, but PlatformInterface.verifyToken rejects any class that does not extend it.

**Impact.** Every PostHog test fails at runtime and PostHog calls go unverified.

**Rule location.** [`context-mill: example-apps/flutter/test/mocks.dart`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/test/mocks.dart) (doc comment on FakePosthogPlatform)

**Sources.** [PostHog/context-mill#276](https://github.com/PostHog/context-mill/pull/276)

**Frameworks.** `flutter`

**Wrong:**

```dart
class MockPosthog extends Mock implements PosthogFlutterPlatformInterface {}
PosthogFlutterPlatformInterface.instance = MockPosthog(); // rejected by verifyToken
```

**Fixed:**

```dart
class FakePosthogPlatform extends PosthogFlutterPlatformInterface {
  final capturedEvents = <CapturedEvent>[];
  @override
  Future<void> capture({required String eventName,
      Map<String, Object>? properties}) async {
    capturedEvents.add((eventName: eventName, properties: properties));
  }
}
// installFakePosthog(): instance = fake; addTearDown(Posthog().close)
```

## Flutter Web target left uninitialized

**Problem.** The Dart Posthog().setup() call looks cross-platform but is a no-op on web. Nothing errors and the web build still runs, so the agent never touches web/index.html or leaves a placeholder token there.

**Impact.** Silent: the Flutter Web build captures nothing, Flutter Web replay stays off without canvas capture, and graders scored such PRs clean until a rubric item was added.

**Rule location.**

- [`context-mill: context/commandments.yaml#flutter`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 279)
- [`context-mill: context/skills/integration-v2/init/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md)
- [`context-mill: context/skills/integration/description-docs-only.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/description-docs-only.md) (step 1 checks web/)
- [`context-mill: example-apps/flutter/web/index.html`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/web/index.html)
- `wizard: src/frameworks/flutter/flutter-wizard-agent.ts`
- [`wizard-workbench: services/pr-evaluator/prompts/evaluation.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation.md) (ph\_all\_targets\_initialized)

**Sources.** [PostHog/context-mill#346](https://github.com/PostHog/context-mill/pull/346), [context-mill@e47207b](https://github.com/PostHog/context-mill/commit/e47207bf), [wizard-workbench@54ecc1a](https://github.com/PostHog/wizard-workbench/commit/54ecc1ad6), [context-mill@e9c9669](https://github.com/PostHog/context-mill/commit/e9c9669e)

**Frameworks.** `flutter`

**Wrong:**

```text
// lib/main.dart only (also runs on web)
await Posthog().setup(config);   // no-op on Flutter Web
<!-- web/index.html: no snippet, or placeholder token -->
posthog.init('phc_your_project_token_here', ...)
```

**Fixed:**

```html
<!-- web/index.html: posthog-js initialises the SDK on web -->
<script async>
  /* standard posthog-js snippet */
  posthog.init("<real token>", { api_host: "https://us.i.posthog.com", defaults: "2025-05-24" });
</script>
<!-- replay: also enable canvas capture in project settings -->
```

## Flutter release builds cannot reach PostHog

**Problem.** Flutter's debug and profile manifests add INTERNET automatically, so everything works while testing. Only release Android and sandboxed macOS builds fail.

**Impact.** Release Android builds and sandboxed macOS apps send no events, silently.

**Rule location.**

- [`context-mill: example-apps/flutter/android/app/src/main/AndroidManifest.xml`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/android/app/src/main/AndroidManifest.xml)
- [`context-mill: example-apps/flutter/macos/Runner/Release.entitlements`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/macos/Runner/Release.entitlements) and DebugProfile.entitlements

**Sources.** [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266), [context-mill@3718730](https://github.com/PostHog/context-mill/commit/37187308)

**Frameworks.** `flutter`

**Wrong:**

```xml
<!-- android/app/src/main/AndroidManifest.xml: no INTERNET -->
<!-- macos entitlements: app-sandbox true, no network.client -->
```

**Fixed:**

```xml
<!-- Required for PostHog to send events in release builds -->
<uses-permission android:name="android.permission.INTERNET"/>
<!-- macos/Runner/Release.entitlements (and DebugProfile.entitlements) -->
<key>com.apple.security.network.client</key>
<true/>
```

## Hand-written middleware instead of the SDK's

**Problem.** Writing a small middleware feels natural, and agents rarely know the SDK ships its own framework integration (PosthogContextMiddleware for Django), so they build identity and exception events with capture().

**Impact.** Fragile, duplicated identity and exception handling that diverges from the SDK's tracing headers and exception capture, and the diff carries code the SDK already covers.

**Rule location.**

- [`context-mill: context/commandments.yaml#django`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('Do NOT create custom middleware')
- [`context-mill: context/skills/posthog-best-practices/description.md#Django`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) ('Do not write custom middleware')
- [`context-mill: context/agents/integration-v2/identify.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/identify.md) (use the SDK's middleware rather than writing your own)
- [`context-mill: example-apps/django/posthog_example/settings.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/django/posthog_example/settings.py)

**Sources.** [context-mill@8092ddb](https://github.com/PostHog/context-mill/commit/8092ddbf), [context-mill@2d1da78](https://github.com/PostHog/context-mill/commit/2d1da788), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#335](https://github.com/PostHog/context-mill/pull/335)

**Frameworks.** `django`

**Wrong:**

```python
class PosthogIdentifyMiddleware:   # hand-written for Django
    def __init__(self, get_response):
        self.get_response = get_response
    def __call__(self, request):
        posthog.capture(distinct_id=request.user.email, event='request', properties={'path': request.path})
        return self.get_response(request)
    def process_exception(self, request, exc):
        posthog.capture(distinct_id=request.user.email, event='$exception', properties={'path': request.path})
```

**Fixed:**

```python
MIDDLEWARE = [
    # ...
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'posthog.integrations.django.PosthogContextMiddleware',
]
# init Posthog() in AppConfig.ready() from env vars
```

## Django context middleware placed before authentication

**Problem.** Agents put new middleware at the top of MIDDLEWARE by habit and the docs snippet just says 'add it'. Request.user is not populated yet, and nothing errors.

**Impact.** Silent: every request context is personless, so server events are not attributed to the logged-in user.

**Rule location.**

- [`context-mill: context/commandments.yaml#django`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('after AuthenticationMiddleware')
- [`context-mill: context/skills/posthog-best-practices/description.md#Django`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) ('placed after Django's AuthenticationMiddleware')
- [`context-mill: example-apps/django/posthog_example/settings.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/django/posthog_example/settings.py) (middleware last)

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@e6532e0](https://github.com/PostHog/context-mill/commit/e6532e0d)

**Frameworks.** `django`

**Wrong:**

```python
MIDDLEWARE = [
    'posthog.integrations.django.PosthogContextMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
]
```

**Fixed:**

```python
MIDDLEWARE = [
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'posthog.integrations.django.PosthogContextMiddleware',  # after auth
]
```

## Client reached through an invented registry

**Problem.** A capable agent designs its own clean seam (app-config registry, explicit distinct id per call) instead of copying how the docs and example project reach the client.

**Impact.** Noisy, foreign-looking diff. Identity repeated at every call site instead of inherited from the request context.

**Rule location.**

- [`context-mill: context/agents/integration-v2/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/init.md) (call sites reach the client 'the way the docs and the example project reach it')
- [`context-mill: context/agents/integration-v2/review.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/review.md) dimension 3 (no invented registry, locator, wrapper)

**Sources.** [context-mill@504f57a](https://github.com/PostHog/context-mill/commit/504f57ae), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `django`, `python`

**Wrong:**

```python
apps.get_app_config("hc").posthog_client.capture(
    distinct_id=str(request.user.id),
    event="project_created",
)
```

**Fixed:**

```python
from posthog import capture

# the middleware already identified this request's context
capture('project_created', properties={'kind': kind})
```

## FastAPI has no SDK middleware to bind identity

**Problem.** The agent assumes FastAPI works like Django and calls bare capture() in handlers, but no PostHog middleware ships for FastAPI.

**Impact.** Captures run outside any context and are personless.

**Rule location.**

- [`context-mill: example-apps/fastapi/app/middleware.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/fastapi/app/middleware.py)
- [`context-mill: context/skills/posthog-best-practices/description.md#FastAPI`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) ('No middleware ships for FastAPI either')

**Sources.** [PostHog/context-mill#63](https://github.com/PostHog/context-mill/pull/63)

**Frameworks.** `fastapi`

**Wrong:**

```python
@router.get("/dashboard")
async def dashboard(current_user: RequiredUser):
    capture("dashboard_viewed")   # no context opened: personless
```

**Fixed:**

```python
# pure ASGI class, registered with app.add_middleware(PostHogMiddleware)
user = self._get_user_from_scope(scope)
with new_context():
    if user:
        identify_context(str(user.id))
        tag("is_staff", user.is_staff)
    await self.app(scope, receive, send)
```

## useEffect used for derived state and callbacks

**Problem.** Older React code and training data reach for useEffect for everything. It works, just with extra renders, so no error points at it.

**Impact.** Extra renders, stale intermediate state and double-fired PostHog calls. No error raised.

**Rule location.** [`context-mill: context/commandments.yaml#react`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (useEffect only to sync with external systems)

**Sources.** [context-mill@0b1e1ec](https://github.com/PostHog/context-mill/commit/0b1e1ec5), [react.dev/learn/you-might-not-need-an-effect](https://react.dev/learn/you-might-not-need-an-effect)

**Frameworks.** `react`, `nextjs`

**Wrong:**

```tsx
useEffect(() => setFull(first + ' ' + last), [first, last])
useEffect(() => { onChange?.(value) }, [value])
useEffect(() => setDraft(''), [userId])
```

**Fixed:**

```tsx
const full = first + ' ' + last                     // compute during render
function handleChange(v) { setValue(v); onChange?.(v) }
<Profile key={userId} />                              // key resets state
```

## Adding use client or use server to make captures work

**Problem.** The fastest way to call a client hook from a server component is to add 'use client', and the type checker and linter accept it.

**Impact.** The file's client/server boundary changes, which can break rendering, server actions or the build.

**Rule location.** `wizard: src/lib/agent/commandments.ts` line 24 (generic minimal-edits rule). Directive-specific rules existed only in legacy src/nextjs/event-setup.ts, deleted in PR 214

**Sources.** [PostHog/wizard#214](https://github.com/PostHog/wizard/pull/214)

**Frameworks.** `nextjs`

**Wrong:**

```tsx
'use client'   // added to a server component just to call posthog.capture
export default function Page() {
  async function track() { 'use server'; /* capture */ }
  // ...
}
```

**Fixed:**

```text
// current rule (generic, no directive-specific ban):
'Prefer minimal, targeted edits that achieve the requested behavior while preserving existing structure and style. Avoid large refactors, broad reformatting, or unrelated changes unless explicitly requested.'
// legacy event-setup prompt (removed in PR 214) said:
// NEVER add 'use client' or 'use server' directives
// NEVER change the file's existing client/server architecture
```

## Next.js App Router and Pages Router mixed up

**Problem.** Recent training data favours the App Router, so the agent creates app/layout.tsx even when the project runs on pages/\_app.tsx.

**Impact.** The provider lands in a file the router never loads, so tracking stays off with no error.

**Rule location.** `wizard: src/frameworks/nextjs/utils.ts` (getNextJsRouter), nextjs-wizard-agent.ts getAdditionalContextLines

**Sources.** [PostHog/wizard#160](https://github.com/PostHog/wizard/pull/160), [PostHog/wizard#176](https://github.com/PostHog/wizard/pull/176), [PostHog/wizard#214](https://github.com/PostHog/wizard/pull/214)

**Frameworks.** `nextjs`

**Wrong:**

```tsx
// pages-router project: pages/_app.tsx exists
// agent creates app/layout.tsx with <PostHogProvider>
// and leaves pages/_app.tsx unchanged
```

**Fixed:**

```ts
gatherContext: async (options) => ({ router: await getNextJsRouter(options) })
// prompt context line:
- Router: app   // or: pages
// both or neither present -> ask the user
```

## Next.js instrumentation file outside src/

**Problem.** Docs show instrumentation-client.ts at the project root. Projects using src/ need it beside src/app, and Next.js ignores the root file.

**Impact.** The file is never loaded. 'Failed to fetch' errors at runtime.

**Rule location.**

- No explicit rule found. context-mill context/commandments.yaml#nextjs only says 'initialize PostHog in instrumentation-client.ts' (line 31)
- wizard issue 154 is open and unfixed. Wizard shape is the desired target, not current text

**Sources.** [PostHog/wizard#154](https://github.com/PostHog/wizard/issues/154)

**Frameworks.** `nextjs`

**Wrong:**

```text
my-app/
  instrumentation-client.ts   <- root, but app lives in src/app
  src/app/layout.tsx
```

**Fixed:**

```text
my-app/
  src/instrumentation-client.ts   <- beside src/app
  src/app/layout.tsx
```

## TypeScript and JavaScript files mixed up

**Problem.** Most examples are TypeScript, and the instructions listed .ts|.js and .tsx|.jsx options, so the agent did not reliably check for tsconfig.json before choosing a file type or syntax.

**Impact.** instrumentation-client.js lands in a TypeScript project, or .tsx files and TS-only syntax land in a JS project whose toolchain cannot compile them. Results vary run to run.

**Rule location.**

- `wizard: src/lib/programs/posthog-integration/index.ts` (lines 252, 326 '- TypeScript: Yes/No')
- isUsingTypeScript in src/utils/setup-utils.ts (line 402, checks tsconfig.json)

**Sources.** [PostHog/wizard#72](https://github.com/PostHog/wizard/pull/72)

**Frameworks.** `nextjs`, `javascript`, `typescript`

**Wrong:**

```tsx
// plain JS project (no tsconfig.json)
// created: components/PostHogProvider.tsx
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, { api_host: '/ingest' })  // `!` is TS-only
// or: TypeScript Next.js 15.3+ project gets instrumentation-client.js
```

**Fixed:**

```typescript
// harness: isUsingTypeScript() = tsconfig.json exists in installDir
// prompt context injected into every run:
- TypeScript: ${typeScriptDetected ? 'Yes' : 'No'}
// legacy (PR 72 fix, removed in PR 214):
// FILE: posthog.${language === 'typescript' ? 'ts' : 'js'}
```

## Shared skill tags leak wrong-platform rules

**Problem.** Commandments are merged by tag, and related platforms share tags (Android carries java, Expo carries react-native), so rules meant for one platform quietly reach another.

**Impact.** Android gets posthog-server singleton/shutdown rules. Expo gets both 'use react-native-config' and 'NOT react-native-config' and wastes turns or wires env loading wrong.

**Rule location.**

- [`context-mill: context/commandments.yaml#java-server`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 112, comment line 111)
- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) java tags \[java, java-server\] (line 255), android \[android, java, kotlin\] (line 188). Expo/react-native conflict at commandments.yaml lines 263 and 269 unresolved
- fix is open PR 249

**Sources.** [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270), [PostHog/context-mill#249](https://github.com/PostHog/context-mill/pull/249)

**Frameworks.** `java`, `android`, `expo`, `react-native`

**Wrong:**

```yaml
# commandments.yaml
java:   # Android variant also carries the java tag
  - posthog-server is the PostHog Java server SDK; build one client with PostHog.with(config)
  - Create a singleton PostHog @Bean, destroyMethod="close"
react-native:   # Expo variant also carries this tag
  - Use react-native-config to load POSTHOG_PROJECT_TOKEN
```

**Fixed:**

```yaml
# merged (PR 270): keyed java-server so backend rules never fold into Android
java-server:   # java variant tags: [java, java-server]
  - Build one client per process ... singleton Spring @Bean
  - Flush and close on shutdown (destroyMethod = "close")
# NOT fixed on main: react-native + expo still contradict (PR 249 open)
```

## No worked example, new shape every run

**Problem.** Docs pages describe API calls but not a whole lifecycle, so when told only to 'read the docs and follow them' each agent improvises client lifecycle, config and shutdown differently.

**Impact.** Five runs on the same app produce five different integrations, so quality is a coin flip in Go, Elixir, Rust, Java and Flutter.

**Rule location.**

- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (go, elixir, rust, java, flutter example\_paths)
- `context-mill: example-apps/.` KMP still uses template description-kmp-docs-only.md

**Sources.** [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266), [PostHog/context-mill#267](https://github.com/PostHog/context-mill/pull/267), [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268), [PostHog/context-mill#269](https://github.com/PostHog/context-mill/pull/269), [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270)

**Frameworks.** `go`, `elixir`, `rust`, `java`, `flutter`

**Wrong:**

```yaml
- id: go
  template: description-go-docs-only.md  # "read the docs, follow them"
  docs_urls: [https://posthog.com/docs/libraries/go.md]
  # no example_paths, no framework
```

**Fixed:**

```yaml
- id: go
  framework: go
  example_paths: example-apps/go  # compiling example packaged as context
  # one client per process, env config, client.Close() on shutdown
# same for elixir, rust, java (java-spring-boot), flutter
```

## Detected framework maps to wrong or no skill

**Problem.** Detector enum names (rails, django) differ from skill menu ids (ruby-on-rails, integration-django), and alias tables, startsWith matching or bare-name installs work until a rename or a variant without a framework key. A failed lookup quietly falls back to no skill.

**Impact.** Wrong reference example (Pages Router for App Router), tasks that run skill-less and write nothing, or a misleading 'failed to download' error on every run.

**Rule location.**

- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (framework/default per variant)
- [`wizard: src/agent/runner/sequence/orchestrator/orchestrator-runner.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/sequence/orchestrator/orchestrator-runner.ts) (resolveSkillVariantId, resolveReferenceSkillId, preflight returning failed(...) on missingVariants)

**Sources.** [PostHog/context-mill#239](https://github.com/PostHog/context-mill/pull/239), [PostHog/wizard#907](https://github.com/PostHog/wizard/pull/907), [PostHog/wizard#909](https://github.com/PostHog/wizard/pull/909), [PostHog/wizard#853](https://github.com/PostHog/wizard/pull/853), [PostHog/wizard#677](https://github.com/PostHog/wizard/pull/677), [PostHog/context-mill#264](https://github.com/PostHog/context-mill/pull/264), [PostHog/context-mill#420](https://github.com/PostHog/context-mill/pull/420), [context-mill@7fbc1ae](https://github.com/PostHog/context-mill/commit/7fbc1aed)

**Frameworks.** `nextjs`, `rails`, `django`, `flask`, `react-router`, `tanstack-router`, `flutter`, `kmp`, `all`

**Wrong:**

```typescript
const FRAMEWORK_VARIANT_ALIASES = { nextjs: 'nextjs-app-router' };
const id = ALIASES[fw] ?? variants.find(v => v.id.startsWith(fw))?.id;
resolveSkillVariantId('rails')   // menu id is ruby-on-rails: no match, 0 files changed
installSkillById('django', ...)   // 404: no reference example
# config.yaml: - id: kmp  (no framework: -> menu emits framework: null)
```

**Fixed:**

```typescript
# config.yaml: every variant declares the detection id
- id: nextjs-app-router
  framework: nextjs
  default: true         # exactly one default per family
// orchestrator-runner.ts: exact lookup on group/framework/default
const family = entries.filter(e => e.group === skillId && e.framework === framework)
return (family.find(e => e.default) ?? family[0])?.id
// preflight: a miss fails the run (code AgentOrchestratorSkillVariantMissing)
if (missingVariants.length > 0) return failed({ message: 'Setup instructions ... failed to download', error: new WizardError('Orchestrator preflight: skill variant missing', { missing, framework }) })
```

## Harness picks family default skill, ignoring detected mode

**Problem.** Resolving a skill from the bare framework id returns the family default, and the resulting code builds and looks fine, so the wrong variant is never noticed.

**Impact.** Mode-specific rules (Astro view-transition init guard and page-load listeners, Expo constants and manual expo-router screens) never reach the agent.

**Rule location.**

- [`wizard: src/agent/runner/sequence/orchestrator/orchestrator-runner.ts#resolveSkillVariantId`](https://github.com/PostHog/wizard/blob/main/src/agent/runner/sequence/orchestrator/orchestrator-runner.ts) (family default, no rendering-mode input)
- [`wizard: src/programs/frameworks/astro/astro-wizard-agent.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/frameworks/astro/astro-wizard-agent.ts) (legacy mode detection)
- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (astro-view-transitions, expo blocks) and context/skills/integration/config.yaml (astro-hybrid and react-native are default: true)

**Sources.** [PostHog/wizard-workbench#2582](https://github.com/PostHog/wizard-workbench/pull/2582), [PostHog/wizard-workbench#3335](https://github.com/PostHog/wizard-workbench/pull/3335), [PostHog/wizard-workbench#4379](https://github.com/PostHog/wizard-workbench/pull/4379), [PostHog/wizard-workbench#4469](https://github.com/PostHog/wizard-workbench/pull/4469)

**Frameworks.** `astro`, `expo`, `react-native`

**Wrong:**

```typescript
// detected: Astro with <ClientRouter /> in Layout.astro, framework 'astro'
resolveSkillVariantId(menuEntries, 'integration', 'astro')
  // -> 'integration-astro-hybrid' (family default: true)
// Expo app, framework 'react-native'
  // -> 'integration-react-native' (default), not 'integration-expo'
```

**Fixed:**

```yaml
# commandments.yaml, only delivered if the matching variant is chosen
astro-view-transitions:
  - Wrap PostHog initialization with a window.__posthog_initialized guard to prevent stack overflow during soft navigation
  - Set capture_pageview option to 'history_change' for automatic pageview tracking during soft navigation
expo:
  - Use expo-constants with app.config.js extras for POSTHOG_PROJECT_TOKEN and POSTHOG_HOST (NOT react-native-config)
```

## Browser apps detected as Node servers

**Problem.** Any package.json looks like a Node project, and first-match detection put the generic Node fallback before the web one with the same signals.

**Impact.** posthog-node lands in a Vite/React SPA with no autocapture or pageviews and server shutdown hooks in a browser bundle. Wrong-framework runs burned agent spend (the '$8.29 bug').

**Rule location.**

- [`wizard: src/shared/constants.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/constants.ts) (Integration enum order)
- src/programs/detection/framework.ts (first-match loop)
- src/programs/frameworks/javascript-web/javascript-web-wizard-agent.ts (detect) and utils.ts (FRAMEWORK\_PACKAGES, hasIndexHtml, detectBundler)
- src/programs/detection/\_\_tests\_\_/framework.test.ts

**Sources.** [PostHog/wizard#817](https://github.com/PostHog/wizard/pull/817), [wizard@f76a176](https://github.com/PostHog/wizard/commit/f76a176d), [PostHog/wizard#313](https://github.com/PostHog/wizard/pull/313), [PostHog/wizard#272](https://github.com/PostHog/wizard/pull/272)

**Frameworks.** `vite`, `react`, `javascript_web`, `javascript_node`

**Wrong:**

```typescript
// Vite SPA, no framework package matched -> javascript_node
import { PostHog } from 'posthog-node'
export const posthog = new PostHog(process.env.POSTHOG_PROJECT_TOKEN!, {
  host: process.env.POSTHOG_HOST,
})
process.on('SIGTERM', () => posthog.shutdown()) // no process in a browser bundle
```

**Fixed:**

```typescript
// Integration enum order IS first-match detection
// Language fallbacks. Keep javascriptNode last: it matches any package.json.
python = 'python',
ruby = 'ruby',
javascript_web = 'javascript_web', // no framework pkg, lockfile, and index.html or a bundler
javascriptNode = 'javascript_node',
```

## Flutter repo misread as a native Android or iOS app

**Problem.** A Flutter repo has real Gradle, AndroidManifest, MainActivity.kt and Xcode files under android/ and ios/, so the first matching native or Java detector claims it.

**Impact.** posthog-android or the native source-map flow is wired into the shell. Dart screens, events and the web target are never tracked, and Java server projects can get claimed as Android.

**Rule location.**

- `wizard: src/lib/constants.ts` (Integration enum order)
- src/frameworks/flutter/flutter-wizard-agent.ts (detect)
- src/frameworks/android/android-wizard-agent.ts and src/frameworks/java/java-wizard-agent.ts (pubspec.yaml guards)
- src/lib/programs/error-tracking-upload-source-maps/detect-agentic.ts (VARIANT\_PRECEDENCE)
- test in src/lib/detection/\_\_tests\_\_/framework.test.ts

**Sources.** [PostHog/wizard#817](https://github.com/PostHog/wizard/pull/817), [PostHog/wizard#942](https://github.com/PostHog/wizard/pull/942), [PostHog/wizard#906](https://github.com/PostHog/wizard/pull/906), [PostHog/wizard#948](https://github.com/PostHog/wizard/pull/948), [PostHog/wizard#985](https://github.com/PostHog/wizard/pull/985), [PostHog/wizard-workbench#3503](https://github.com/PostHog/wizard-workbench/pull/3503)

**Frameworks.** `flutter`, `android`, `ios`, `java`, `swift`

**Wrong:**

```kotlin
// android/app/src/main/kotlin/.../MainActivity.kt inside a Flutter app
class MainActivity : FlutterActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    PostHogAndroid.setup(application, PostHogAndroidConfig(KEY, HOST))
  } // Dart code untouched
}
```

**Fixed:**

```typescript
// constants.ts: flutter is ordered before kmp/swift/android; java comes after them
flutter = 'flutter',
// flutter detect: anchored to a key/value line, so '# sdk: flutter' and pure Dart don't match
/^\s*sdk:\s*flutter\s*$/m.test(pubspec ?? '')
// android + java detect():
// pubspec.yaml means Flutter — its android/ subtree would match below.
if (fs.existsSync(path.join(installDir, 'pubspec.yaml'))) return false;
// source maps: VARIANT_PRECEDENCE = ['react-native', 'flutter', 'android', 'ios', ...]
```

## Android, KMP and JVM server confused by Gradle

**Problem.** build.gradle alone does not say which runtime it builds, so the agent picks a PostHog JVM artifact without checking for Android or KMP markers.

**Impact.** posthog-android lands on a Spring server, or posthog-server in an Android app. The build fails or the SDK never initialises.

**Rule location.**

- `wizard: src/frameworks/java/java-wizard-agent.ts` (detect + prompts)
- src/frameworks/kmp/kmp-wizard-agent.ts
- src/frameworks/android/android-wizard-agent.ts
- src/lib/constants.ts (enum order)
- src/lib/detection/\_\_tests\_\_/framework.test.ts

**Sources.** [PostHog/wizard#948](https://github.com/PostHog/wizard/pull/948), [PostHog/wizard#906](https://github.com/PostHog/wizard/pull/906)

**Frameworks.** `java`, `android`, `kmp`

**Wrong:**

```kotlin
// app/build.gradle.kts of a com.android.application module
dependencies {
  implementation("com.posthog:posthog-server:<VERSION>") // server SDK in an Android app
}
```

**Fixed:**

```kotlin
// Android app:   implementation("com.posthog:posthog-android:<VERSION>")
// KMP commonMain: implementation("com.posthog:posthog-kmp:<VERSION>")
// java detect(): pubspec.yaml => false; pom.xml => true;
//   gradle => false if it has com.android.application / com.android.library /
//   kotlin("multiplatform") markers, else true only if no AndroidManifest.xml anywhere
// enum order: kmp, swift, android BEFORE java (enforced by a test)
// java prompt: posthog-android must not be used on the server
```

## Framework detected from a stray word

**Problem.** A substring check for 'django' or 'flask' is the quick test, and it matches comments, strings and plugin names like django-extensions.

**Impact.** A non-Django repo gets Django settings and middleware edits, or a Django project gets the generic Python skill without middleware.

**Rule location.**

- `wizard: src/frameworks/django/django-wizard-agent.ts` (detect)
- same anchored regex + import pattern in src/frameworks/flask/flask-wizard-agent.ts and src/frameworks/fastapi/fastapi-wizard-agent.ts. python-wizard-agent.ts still uses a loose includes('django') only to defer to Django

**Sources.** [PostHog/wizard#258](https://github.com/PostHog/wizard/pull/258)

**Frameworks.** `django`, `flask`, `fastapi`

**Wrong:**

```typescript
# manage.py in a project that is NOT Django
print('Hello from my-django-app')
# naive check:
content.includes('django') || content.includes('DJANGO_SETTINGS_MODULE')  // -> true
```

**Fixed:**

```typescript
// django detect(): real imports/usage only
content.includes('from django') || content.includes('import django') ||
  content.includes('DJANGO_SETTINGS_MODULE') || /execute_from_command_line/.test(content)
// requirements/pyproject: a package line, not a comment, not django-extensions
/^django([>=~!<\s]|$)/im.test(content) || /["']django["']/i.test(content)
```

## Missing package.json crashes detection and setup

**Problem.** JS-first tooling reads package.json unconditionally, but non-Node projects have none and a user can pick a JS framework by hand or run from outside the app root.

**Impact.** Running in a Django, Laravel or other non-Node project, or picking a JS framework manually, aborts the wizard instead of letting the agent find the right directory.

**Rule location.**

- `wizard: src/utils/setup-utils.ts` (tryGetPackageJson vs getPackageDotJson)
- src/frameworks/\*/ (detection.usesPackageJson, e.g. nextjs, svelte, django)
- src/lib/programs/posthog-integration/index.ts

**Sources.** [PostHog/wizard#230](https://github.com/PostHog/wizard/pull/230), [PostHog/wizard#327](https://github.com/PostHog/wizard/pull/327)

**Frameworks.** `django`, `flask`, `laravel`, `python`, `nextjs`, `react-router`, `vue`, `nuxt`, `angular`, `astro`, `react-native`

**Wrong:**

```typescript
detect: async (options) => {
  const packageJson = await getPackageDotJson(options)   // aborts if missing
  return hasPackageInstalled('next', packageJson)
}
```

**Fixed:**

```typescript
detect: async (options) => {
  const packageJson = await tryGetPackageJson(options)   // null when absent
  return packageJson ? hasDeclaredDependency('next', packageJson) : false
}
// non-Node frameworks set usesPackageJson: false
// runner: 'Could not find package.json. Continuing anyway — the agent will handle it.'
```

## Monorepo scan mixes up or misses sub-projects

**Problem.** An agent scanning many projects writes the report from memory at the end, so facts drift between similar names and the generic match wins over a more specific one. Audits also scan only the repo root (issue #740, still open).

**Impact.** backend1's facts land on backend2, node+rollup collapses to plain node, or sub-apps are never audited, so the wrong SDK or skill variant is chosen.

**Rule location.** `wizard: src/lib/detection/agentic.ts` (buildPrompt, deriveReportJson, coerceAgenticReport with rerankIds)

**Sources.** [PostHog/wizard#1071](https://github.com/PostHog/wizard/pull/1071), [PostHog/wizard#1350](https://github.com/PostHog/wizard/pull/1350), [PostHog/wizard#740](https://github.com/PostHog/wizard/issues/740)

**Frameworks.** `javascript_node`, `rollup`

**Wrong:**

```text
// final report assembled from memory after reading backend1 and backend2
{"path":"backend2","framework":"Express","targetId":"javascript_node"} // backend1's facts
// package.json has rollup + node deps -> 'javascript_node', rollup dropped
```

**Fixed:**

```text
// per project, right after reading its manifest, one JSON line:
{"path":"backend2","framework":"Rollup","matchingTargets":["rollup","javascript_node"],"targetId":"rollup",
 "hasPostHog":false,"evidence":"rollup in devDependencies of backend2/package.json"}
// report = deriveReportJson(transcript lines)
// coerceAgenticReport(..., { rerankIds }): the most specific enumerated JS target overrides the pick
```

## Monorepo root instrumented instead of the app

**Problem.** Detection and install run in the current directory. A monorepo root has a package.json with only workspaces, so it looks like a generic Node project.

**Impact.** The SDK and report land in the root or the wrong sibling, and the real app is not instrumented.

**Rule location.**

- `wizard: src/lib/detection/project-scope.ts` (scopeInstallDirToProject, chooseIntegrationProject)
- src/lib/detection/agentic.ts
- docs/runbooks/agentic-monorepo-detection.md

**Sources.** [PostHog/wizard#884](https://github.com/PostHog/wizard/pull/884), [PostHog/wizard#1071](https://github.com/PostHog/wizard/pull/1071), [PostHog/wizard#1350](https://github.com/PostHog/wizard/pull/1350), [PostHog/wizard#760](https://github.com/PostHog/wizard/pull/760), [PostHog/wizard#689](https://github.com/PostHog/wizard/pull/689), [PostHog/wizard#113](https://github.com/PostHog/wizard/issues/113), [PostHog/wizard#1305](https://github.com/PostHog/wizard/pull/1305), [PostHog/wizard#892](https://github.com/PostHog/wizard/pull/892)

**Frameworks.** `all`

**Wrong:**

```text
# pnpm monorepo, apps/dashboard = Next.js
detectFramework('.') -> javascript_node
pnpm add posthog-node     # into root package.json
```

**Fixed:**

```text
// scopeInstallDirToProject (flag-gated, headless/CI): scan, then re-point installDir
Scanning the repo for projects...
Continuing with apps/dashboard (Next.js).
// agent labels exactly one project `recommended`; chooseIntegrationProject takes it,
// else the first instrumentable PostHog-free one
// scan error / 60s timeout / no project -> session.installDir untouched, root detection
```

## Monorepo services in other languages missed

**Problem.** The root package.json workspace list looks like the full package map, so Python or Go services elsewhere in the tree are never found.

**Impact.** Those services get no metrics, and sibling services share one service\_name.

**Rule location.** [`context-mill: context/agents/metrics/setup-metrics.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/metrics/setup-metrics.md)

**Sources.** [PostHog/context-mill#342](https://github.com/PostHog/context-mill/pull/342)

**Frameworks.** `all`

**Wrong:**

```text
# root package.json has workspaces: ["apps/web"]
# -> one JS package; apps/api/pyproject.toml and workers/go.mod never found
```

**Fixed:**

```text
# one find per manifest pattern across the whole tree, every time:
**/package.json **/pyproject.toml **/requirements.txt **/Pipfile
**/go.mod **/composer.json **/Gemfile
# each service: verify-sdk -> instrument-metrics with
# inputs: { package: "<path>", service_name: "<name>" }
```

## Go or Rust repo with tooling package.json read as JS

**Problem.** A lint or husky package.json beside go.mod or Cargo.toml matches the JS fallback first.

**Impact.** Wrong integration skill and upload path. A Go or Rust service gets JS instrumentation.

**Rule location.**

- [`wizard: src/shared/constants.ts`](https://github.com/PostHog/wizard/blob/main/src/shared/constants.ts) (Integration enum)
- src/programs/frameworks/go/go-wizard-agent.ts, src/programs/frameworks/rust/rust-wizard-agent.ts
- src/programs/error-tracking-upload-source-maps/detect-agentic.ts

**Sources.** [PostHog/wizard#945](https://github.com/PostHog/wizard/pull/945), [PostHog/wizard#947](https://github.com/PostHog/wizard/pull/947), [PostHog/wizard#938](https://github.com/PostHog/wizard/pull/938)

**Frameworks.** `go`, `rust`

**Wrong:**

```text
go-service/
  go.mod
  package.json   # lint/husky tooling only
// javascript_node matches any package.json -> picked first
```

**Fixed:**

```ts
go = 'go', rust = 'rust',  // before the language fallbacks
// javascriptNode stays last: it matches any package.json
detect: !!goMod && /^module\s+\S+/m.test(goMod)
// source maps: [..., 'node', 'go', 'rust', 'web']
```

## Workspace roots and stray manifests claimed as apps

**Problem.** Any Cargo.toml, go.mod, mix.exs or pubspec.yaml looks like a project root, though workspace roots and pure Dart packages are not apps.

**Impact.** The SDK is installed at a virtual workspace root, in a directory with no module, or in a pure Dart package.

**Rule location.** `wizard: src/programs/frameworks/{rust,go,elixir,flutter}/*-wizard-agent.ts` (detection.detect)

**Sources.** [PostHog/wizard#947](https://github.com/PostHog/wizard/pull/947), [PostHog/wizard#945](https://github.com/PostHog/wizard/pull/945), [PostHog/wizard#946](https://github.com/PostHog/wizard/pull/946), [PostHog/wizard#942](https://github.com/PostHog/wizard/pull/942)

**Frameworks.** `rust`, `go`, `elixir`, `flutter`

**Wrong:**

```toml
# Cargo.toml at repo root
[workspace]
members = ["crates/*"]
# agent runs `cargo add posthog-rs` at the workspace root (no [package])
```

**Fixed:**

```ts
rust:    /^\s*\[package\]/m.test(cargoToml)  // workspace-only root -> agentic scan
go:      /^module\s+\S+/m.test(goMod)
elixir:  /def\s+project\b/.test(mixExs)
flutter: /^\s*sdk:\s*flutter\s*$/m.test(pubspec)  // pure Dart falls through
```

## Run continues with no framework detected

**Problem.** An undefined framework flows into later steps, which then fail with an unrelated-looking error.

**Impact.** Misleading 'setup instructions failed to download' error. 37 production users in seven days.

**Rule location.** [`wizard: src/programs/shared/abort-no-framework.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/shared/abort-no-framework.ts)

**Sources.** [PostHog/wizard#1347](https://github.com/PostHog/wizard/pull/1347), [PostHog/wizard#1349](https://github.com/PostHog/wizard/pull/1349)

**Frameworks.** `all`

**Wrong:**

```typescript
const integration = await detectFramework(installDir) // undefined
// no guard: continues to skill preflight / agent run
await runIntegration({ ...session, framework: integration })
```

**Fixed:**

```typescript
if (!config.framework) abortNoFrameworkDetected()
// ErrorCodes.DetectNoFramework + app-root guidance,
// before agent execution or skill preflight; manual picker kept
```

## Existing native PostHog install not seen

**Problem.** Presence checks grep only web-language manifests, so SPM, CocoaPods, Gradle, NuGet, mix and Cargo installs look like no PostHog.

**Impact.** The flow sets PostHog up again, or dead-ends at 'Nothing to set up here' for a native app.

**Rule location.**

- [`wizard: src/programs/self-driving/detect.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/self-driving/detect.ts) (POSTHOG\_MANIFESTS)
- src/programs/detection/agentic.ts

**Sources.** [PostHog/wizard#803](https://github.com/PostHog/wizard/pull/803), [PostHog/wizard#760](https://github.com/PostHog/wizard/pull/760), [PostHog/context-mill#213](https://github.com/PostHog/context-mill/pull/213)

**Frameworks.** `swift`, `ios`, `android`, `react-native`, `flutter`, `dotnet`, `elixir`, `rust`

**Wrong:**

```typescript
['package.json','requirements.txt','pyproject.toml','Pipfile',
 'Gemfile','go.mod','composer.json','pubspec.yaml']
// dirs: ., app, frontend, backend
```

**Fixed:**

```typescript
POSTHOG_MANIFESTS = [..., 'Package.swift','Podfile','Podfile.lock','project.yml',
  'build.gradle','build.gradle.kts','gradle/libs.versions.toml','pom.xml','mix.exs','Cargo.toml']
// + ios/, android/, depth-2 walk, *.xcodeproj/project.pbxproj, *.csproj
POSTHOG_PACKAGE_RE = /(^|["'\s/=:.@])posthog/im
```

## XcodeGen iOS app not detected

**Problem.** Detection expects a committed \*.xcodeproj at the root, but XcodeGen apps commit project.yml and generate the project locally. Many use .xcworkspace.

**Impact.** The iOS app is invisible to detection and the picker, no Swift integration can run, and the wizard offers integration again for an app that already has PostHog.

**Rule location.**

- [`wizard: src/programs/frameworks/swift/swift-wizard-agent.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/frameworks/swift/swift-wizard-agent.ts) (detect)
- src/programs/frameworks/swift/utils.ts
- src/programs/detection/agentic.ts

**Sources.** [PostHog/wizard#803](https://github.com/PostHog/wizard/pull/803), [PostHog/context-mill#213](https://github.com/PostHog/context-mill/pull/213)

**Frameworks.** `swift`, `ios`, `xcodegen`

**Wrong:**

```typescript
const xcodeProjects = await fg('*.xcodeproj', { cwd: installDir, onlyDirectories: true })
if (xcodeProjects.length === 0) return false // repo has project.yml + Sources/*.swift
```

**Fixed:**

```typescript
const xcodeProjects = await fg('*.{xcodeproj,xcworkspace}', { cwd: installDir, onlyDirectories: true })
const hasXcodeGenSpec = fs.existsSync(path.join(installDir, 'project.yml'))
if (xcodeProjects.length > 0 || hasXcodeGenSpec) {
  // then require at least one *.swift file outside .build and *.xcodeproj
}
```

## Non-JS manifests ignored during platform detection

**Problem.** The omnibus detection step listed only some manifests and lockfiles (no pubspec.yaml, mix.exs, go.sum). Flutter and Elixir projects matched nothing, and the agent never loaded the matching SDK docs.

**Impact.** The agent improvises setup for Flutter and Elixir projects, and misses Go lockfile detection, instead of following the matching guide.

**Rule location.** [`context-mill: context/skills/omnibus/instrument-integration/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-integration/description.md) (and instrument-product-analytics, instrument-error-tracking, instrument-feature-flags, detection step, lines 13-15)

**Sources.** [PostHog/context-mill#150](https://github.com/PostHog/context-mill/pull/150), [PostHog/context-mill#153](https://github.com/PostHog/context-mill/pull/153), [PostHog/context-mill#154](https://github.com/PostHog/context-mill/pull/154)

**Frameworks.** `flutter`, `go`, `elixir`

**Wrong:**

```text
dependency files: package.json, Podfile, Package.swift, requirements.txt, go.mod, Gemfile, composer.json
lockfiles: pnpm-lock.yaml, package-lock.json, yarn.lock, bun.lockb, Podfile.lock, Package.resolved
# pubspec.yaml, mix.exs, pubspec.lock, go.sum, mix.lock never checked
```

**Fixed:**

```text
dependency files: package.json, pubspec.yaml, Podfile, Package.swift, requirements.txt, Gemfile, composer.json, go.mod, mix.exs, ...
lockfiles: pnpm-lock.yaml, package-lock.json, yarn.lock, bun.lockb, go.sum, pubspec.lock, Podfile.lock, Package.resolved, mix.lock
```

## React Router v7 SSR missing ssr.noExternal

**Problem.** Installing the packages and wrapping the root looks complete. The ssr.noExternal requirement lives only in the fetched doc and example, with no commandment, and the failure only shows on a server render.

**Impact.** SSR bundling or resolve errors when server-rendered components import @posthog/react, so the build or first server render fails. Graders mark it CRITICAL.

**Rule location.**

- [`context-mill: example-apps/react-react-router-7-framework/vite.config.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-7-framework/vite.config.ts)
- docs react-router-v7-framework-mode.md (via integration/config.yaml)
- no commandment for tag react-router

**Sources.** [PostHog/wizard-workbench#3112](https://github.com/PostHog/wizard-workbench/pull/3112), [PostHog/wizard-workbench#4364](https://github.com/PostHog/wizard-workbench/pull/4364), [PostHog/wizard-workbench#4178](https://github.com/PostHog/wizard-workbench/pull/4178), [PostHog/wizard-workbench#4407](https://github.com/PostHog/wizard-workbench/pull/4407), [PostHog/wizard-workbench#4173](https://github.com/PostHog/wizard-workbench/pull/4173), [PostHog/wizard-workbench#4445](https://github.com/PostHog/wizard-workbench/pull/4445), [PostHog/wizard-workbench#3972](https://github.com/PostHog/wizard-workbench/pull/3972), [context-mill@87ec8fa](https://github.com/PostHog/context-mill/commit/87ec8fa8), [PostHog/wizard-workbench#4406](https://github.com/PostHog/wizard-workbench/pull/4406), [PostHog/wizard-workbench#4049](https://github.com/PostHog/wizard-workbench/pull/4049), [PostHog/wizard-workbench#4302](https://github.com/PostHog/wizard-workbench/pull/4302), [context-mill@933a28c](https://github.com/PostHog/context-mill/commit/933a28c3)

**Frameworks.** `react-router`

**Wrong:**

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
})
```

**Fixed:**

```typescript
export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  ssr: {
    noExternal: ['posthog-js', '@posthog/react'],
  },
})
```

## React Router modes need different init placement

**Problem.** React Router v6 and v7 framework, data and declarative modes have different entry files, and agents default to the vanilla SPA main.tsx pattern. In v7 framework mode there is no main.tsx, and module-level init in root.tsx also runs on the server.

**Impact.** Init lands in a file that never runs or runs during SSR, or provider and error boundary wiring is missing, so PostHog throws on the server, never initializes, or loses errors.

**Rule location.**

- [`wizard: src/programs/frameworks/react-router/react-router-wizard-agent.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/frameworks/react-router/react-router-wizard-agent.ts) utils.ts (getReactRouterMode, main layout, older checkouts use src/frameworks/react-router/)
- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (react-react-router-7-\* variants)
- [`context-mill: example-apps/react-react-router-7-framework/app/entry.client.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-7-framework/app/entry.client.tsx)

**Sources.** [PostHog/wizard#215](https://github.com/PostHog/wizard/pull/215), [PostHog/wizard#332](https://github.com/PostHog/wizard/pull/332), [PostHog/wizard#252](https://github.com/PostHog/wizard/pull/252)

**Frameworks.** `react-router`

**Wrong:**

```tsx
// v7 framework mode (react-router.config.ts, SSR): no main.tsx
// app/root.tsx
import posthog from 'posthog-js'
posthog.init(import.meta.env.VITE_POSTHOG_KEY)  // also runs on the server
// no entry.client.tsx, no posthogMiddleware, no root ErrorBoundary
```

**Fixed:**

```text
react-router.config.ts  -> v7 framework: entry.client.tsx init
                           + posthogMiddleware (root.tsx) + root ErrorBoundary
                           + ssr.noExternal in vite.config.ts
createBrowserRouter     -> v7 data: index.tsx init + RootErrorBoundary
<BrowserRouter          -> v7 declarative: main.tsx init + PostHogErrorBoundary
react-router 6          -> its own example; below 6.0.0 refused
```

## macOS sandbox disabled for network access

**Problem.** The SDK installs and compiles fine. The sandbox silently blocks outbound requests, and turning the sandbox off is the quickest fix that makes events flow.

**Impact.** No events from a sandboxed macOS app, or the sandbox is disabled and the app loses protections and App Store eligibility when one entitlement was enough.

**Rule location.**

- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (swift key, line ~248)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (Swift section, line ~221)
- [`context-mill: example-apps/swift/BurritoConsiderationClient.xcodeproj/project.pbxproj`](https://github.com/PostHog/context-mill/blob/main/example-apps/swift/BurritoConsiderationClient.xcodeproj/project.pbxproj) (lines 258-259, 300-301)

**Sources.** [PostHog/context-mill#71](https://github.com/PostHog/context-mill/pull/71), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [context-mill@3ed37d4](https://github.com/PostHog/context-mill/commit/3ed37d49), [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266), [context-mill@3718730](https://github.com/PostHog/context-mill/commit/37187308)

**Frameworks.** `swift`, `macos`

**Wrong:**

```text
// project.pbxproj
ENABLE_APP_SANDBOX = NO;
/* or: ENABLE_APP_SANDBOX = YES; with no ENABLE_OUTGOING_NETWORK_CONNECTIONS */
```

**Fixed:**

```text
// project.pbxproj
ENABLE_APP_SANDBOX = YES;
ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES;
```

## Session replay turned on for macOS targets

**Problem.** The Swift SDK config is shared across Apple targets, so the agent sets sessionReplay everywhere without knowing replay is iOS-only or checking masking needs.

**Impact.** macOS targets silently record nothing, and enabling replay blind can capture sensitive screens.

**Rule location.** [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (ios key, line ~256)

**Sources.** [PostHog/context-mill#151](https://github.com/PostHog/context-mill/pull/151)

**Frameworks.** `ios`, `swift`, `macos`

**Wrong:**

```swift
let config = PostHogConfig(apiKey: key, host: host)
config.sessionReplay = true // also on the macOS target
```

**Fixed:**

```swift
// rule: only after confirming project replay settings and masking needs;
// replay is iOS-only, not macOS. #if os(iOS) is one way to keep it off macOS
#if os(iOS)
config.sessionReplay = true
#endif
```

## Android SDK set up in an Activity

**Problem.** MainActivity.onCreate is the most visible entry point, and many apps have no custom Application class, so agents init there.

**Impact.** Setup reruns on every Activity creation and early events are missed.

**Rule location.**

- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (android key, lines ~318-319)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (Android section, line ~228)
- [`context-mill: example-apps/android/app/src/main/java/com/example/posthog/BurritoApp.kt`](https://github.com/PostHog/context-mill/blob/main/example-apps/android/app/src/main/java/com/example/posthog/BurritoApp.kt) (defines class BurritoApplication)

**Sources.** [PostHog/context-mill#69](https://github.com/PostHog/context-mill/pull/69), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [context-mill@d9589e7](https://github.com/PostHog/context-mill/commit/d9589e71), [context-mill@e8a92b5](https://github.com/PostHog/context-mill/commit/e8a92b53)

**Frameworks.** `android`, `kotlin`

**Wrong:**

```kotlin
class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    PostHogAndroid.setup(this, config)   // per-activity
  }
}
```

**Fixed:**

```kotlin
class BurritoApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    PostHogAndroid.setup(this, config)   // exactly once, as early as possible
  }
}
// AndroidManifest: android:name=".BurritoApplication"
```

## Android activities missing android:label

**Problem.** Screen views are captured automatically, so turning them on is the visible step. The manifest label they rely on is a separate file the agent has no reason to edit.

**Impact.** Silent: screen analytics show blank or class-name screens.

**Rule location.** [`context-mill: context/commandments.yaml#android`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#69](https://github.com/PostHog/context-mill/pull/69), [context-mill@e8a92b5](https://github.com/PostHog/context-mill/commit/e8a92b53)

**Frameworks.** `android`

**Wrong:**

```xml
<activity
    android:name=".CheckoutActivity"
    android:exported="false" />
```

**Fixed:**

```xml
<activity
    android:name=".CheckoutActivity"
    android:label="Checkout"
    android:exported="false" />
```

## Android dependency in wrong Gradle syntax

**Problem.** Docs show one dependency syntax, but projects use Groovy or Kotlin DSL, and root vs app modules. The agent must match the file it edits.

**Impact.** Gradle sync fails, or the dependency sits in a module that never ships.

**Rule location.**

- `wizard: src/frameworks/android/android-wizard-agent.ts` (prompts.packageInstallation: 'app-level build.gradle(.kts) ... match the existing format')
- [`context-mill: context/commandments.yaml#android`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('Adapt dependency configuration to the appropriate build.gradle(.kts) file')

**Sources.** [PostHog/wizard#262](https://github.com/PostHog/wizard/pull/262), [PostHog/context-mill#69](https://github.com/PostHog/context-mill/pull/69)

**Frameworks.** `android`, `kotlin`

**Wrong:**

```kotlin
// app/build.gradle.kts (Kotlin DSL)
dependencies {
    implementation 'com.posthog:posthog-android:3.+'   // Groovy syntax
}
```

**Fixed:**

```kotlin
// app-level build.gradle(.kts); match the existing format
implementation("com.posthog:posthog-android:<VERSION>")   // .kts
implementation 'com.posthog:posthog-android:<VERSION>'    // .gradle
```

## KMP SDK added per platform

**Problem.** A Kotlin Multiplatform project also looks like an Android and an iOS project, and agents know the native SDKs better than the 0.x posthog-kmp artifact, so they add those to platform source sets or the app module.

**Impact.** Only one platform instrumented, shared code has no client, or two SDKs double-send, while the build succeeds.

**Rule location.**

- [`context-mill: context/commandments.yaml#kmp`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: context/skills/integration/description-kmp-docs-only.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/description-kmp-docs-only.md)
- `wizard: src/frameworks/kmp/kmp-wizard-agent.ts`
- src/lib/constants.ts (kmp ordered before swift/android)

**Sources.** [PostHog/context-mill#240](https://github.com/PostHog/context-mill/pull/240), [PostHog/wizard#906](https://github.com/PostHog/wizard/pull/906), [context-mill@68c198f](https://github.com/PostHog/context-mill/commit/68c198f2)

**Frameworks.** `kmp`, `android`, `swift`

**Wrong:**

```kotlin
kotlin {
  sourceSets {
    androidMain.dependencies {
      implementation("com.posthog:posthog-android:3.+")
    }
  }
}
```

**Fixed:**

```kotlin
commonMain.dependencies {
  implementation("com.posthog:posthog-kmp:<latest from Maven Central>")
}
// shared code, once, early
PostHog.setup(config = PostHogConfig(apiKey = token, host = host), context = PostHogContext())
```

## KMP setup without platform PostHogContext

**Problem.** The common-code setup call takes a per-platform context type that is not obvious, and agents copy the single-argument native setup shape.

**Impact.** Setup fails on Android, which needs the Application, or compiles on one target only.

**Rule location.**

- `wizard: src/frameworks/kmp/kmp-wizard-agent.ts` (prompts.getAdditionalContextLines)
- [`context-mill: context/commandments.yaml#kmp`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('PostHogContext is platform-specific')
- [`context-mill: context/skills/integration/description-kmp-docs-only.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/description-kmp-docs-only.md) (step 5)

**Sources.** [PostHog/wizard#906](https://github.com/PostHog/wizard/pull/906), [wizard@983dbe0](https://github.com/PostHog/wizard/commit/983dbe0a), [PostHog/context-mill#240](https://github.com/PostHog/context-mill/pull/240)

**Frameworks.** `kmp`

**Wrong:**

```kotlin
PostHog.setup(config = PostHogConfig(apiKey = token, host = host))  // no context
```

**Fixed:**

```kotlin
// Android
PostHog.setup(config, context = PostHogContext(application))
// iOS and Web
PostHog.setup(config, context = PostHogContext())
// imports: com.posthog.kmp.PostHog, PostHogConfig, PostHogContext
```

## Astro PostHog script missing is:inline

**Problem.** A plain &lt;script> is how the snippet goes in any HTML page, but Astro bundles and type-checks it as a module. Unprefixed env vars also never reach the browser.

**Impact.** Strict TypeScript fails on window.posthog, the snippet is bundled out of order, and unprefixed env values are undefined in the browser, so no events are sent.

**Rule location.**

- [`context-mill: context/commandments.yaml#astro`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('Always use the is:inline directive', 'Use PUBLIC\_ prefix')
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (Astro section)
- [`context-mill: example-apps/astro-static/src/components/posthog.astro`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-static/src/components/posthog.astro) astro-view-transitions/src/components/posthog.astro

**Sources.** [PostHog/context-mill#73](https://github.com/PostHog/context-mill/pull/73), [context-mill@4bc9071](https://github.com/PostHog/context-mill/commit/4bc9071c), [PostHog/wizard#267](https://github.com/PostHog/wizard/pull/267), [PostHog/wizard-workbench#1720](https://github.com/PostHog/wizard-workbench/pull/1720)

**Frameworks.** `astro`

**Wrong:**

```html
<script>
  posthog.init(import.meta.env.POSTHOG_PROJECT_TOKEN, { api_host: '/ingest' })
  window.posthog?.capture('contact_form_submitted')  // TS: no 'posthog' on Window
</script>
```

**Fixed:**

```html
<script is:inline define:vars={{
  apiKey: import.meta.env.PUBLIC_POSTHOG_PROJECT_TOKEN,
  apiHost: import.meta.env.PUBLIC_POSTHOG_HOST,
}}>
  !function(t,e){/* snippet */}(document,window.posthog||[]);
  posthog.init(apiKey, { api_host: apiHost })
</script>
```

## npm import inside Astro inline script

**Problem.** Fixing is:inline and then importing posthog-js looks right, but is:inline disables bundling and browsers cannot resolve bare specifiers.

**Impact.** Silent: PostHog never initializes in production and window.posthog?.capture calls no-op.

**Rule location.**

- `context-mill: example-apps/astro-static|astro-view-transitions|astro-ssr|astro-hybrid/src/components/posthog.astro` (CDN snippet inside is:inline, no explicit bare-import ban)
- [`context-mill: context/commandments.yaml#astro`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (is:inline directive)

**Sources.** [PostHog/wizard-workbench#2963](https://github.com/PostHog/wizard-workbench/pull/2963), [PostHog/context-mill#73](https://github.com/PostHog/context-mill/pull/73)

**Frameworks.** `astro`

**Wrong:**

```html
<script is:inline define:vars={{ projectToken, host }}>
  import('posthog-js').then(({ default: posthog }) => {
    posthog.init(projectToken, { api_host: host });
  });
</script>
```

**Fixed:**

```html
<script is:inline define:vars={{ apiKey: import.meta.env.PUBLIC_POSTHOG_PROJECT_TOKEN, apiHost: import.meta.env.PUBLIC_POSTHOG_HOST }}>
  !function(t,e){...}(document,window.posthog||[]);   // CDN snippet
  posthog.init(apiKey, { api_host: apiHost, defaults: '2026-01-30' })
</script>
```

## Astro view transitions re-run init

**Problem.** DOMContentLoaded init is standard, but ClientRouter soft navigation re-executes inline scripts and does not fire normal page loads.

**Impact.** Repeated init (stack overflow on soft navigation per the example README) and missing pageviews.

**Rule location.**

- [`context-mill: context/commandments.yaml#astro-view-transitions`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: example-apps/astro-view-transitions/src/components/posthog.astro`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-view-transitions/src/components/posthog.astro) (and README)

**Sources.** [PostHog/context-mill#73](https://github.com/PostHog/context-mill/pull/73), [PostHog/wizard-workbench#4427](https://github.com/PostHog/wizard-workbench/pull/4427), [PostHog/wizard#267](https://github.com/PostHog/wizard/pull/267), [wizard@45fa91b](https://github.com/PostHog/wizard/commit/45fa91b0), [context-mill@4bc9071](https://github.com/PostHog/context-mill/commit/4bc9071c), [`context-mill: example-apps/astro-view-transitions/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-view-transitions/README.md)

**Frameworks.** `astro`

**Wrong:**

```javascript
document.addEventListener('DOMContentLoaded', () => {
  posthog.init(key, { api_host });
});
```

**Fixed:**

```javascript
if (!window.__posthog_initialized) {
  window.__posthog_initialized = true;
  // ...posthog snippet...
  posthog.init(key, {
    api_host,
    capture_pageview: 'history_change'
  });
}
```

## Astro handlers bound once, lost after soft navigation

**Problem.** Top-level or DOMContentLoaded listeners are the standard pattern and work on first load. The breakage only appears after a ClientRouter page swap.

**Impact.** After soft navigation the new elements have no handlers, so custom captures silently stop (or, if re-bound naively, duplicate).

**Rule location.**

- [`context-mill: context/commandments.yaml#astro-view-transitions`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (use astro:page-load instead of just DOMContentLoaded)
- [`context-mill: example-apps/astro-view-transitions/src/pages/burrito.astro`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-view-transitions/src/pages/burrito.astro) (setupBurritoPage)

**Sources.** [PostHog/wizard-workbench#4427](https://github.com/PostHog/wizard-workbench/pull/4427), [PostHog/context-mill#73](https://github.com/PostHog/context-mill/pull/73)

**Frameworks.** `astro`

**Wrong:**

```html
<script is:inline>
  document.querySelector('[data-posthog-event="free_trial_cta_clicked"]')
    ?.addEventListener('click', () => {
      window.posthog?.capture('free_trial_cta_clicked', { cta_location: 'home_hero' });
    });
</script>
```

**Fixed:**

```js
function setupBurritoPage() {
  const btn = document.getElementById('consider-btn');
  // remove first to prevent duplicates during view transitions
  btn?.removeEventListener('click', handleConsideration);
  btn?.addEventListener('click', handleConsideration);
}
document.addEventListener('DOMContentLoaded', setupBurritoPage);
document.addEventListener('astro:page-load', setupBurritoPage);
```

## Astro API routes prerendered, server capture never runs

**Problem.** Older Astro docs used output 'hybrid' or 'server'. In Astro 5 static output with an adapter prerenders routes by default, so the agent either flips the whole site to SSR, doubts the config, or forgets the per-route opt-out.

**Impact.** Either every page loses prerendering, or the POST route is prerendered with no runtime handler, so server-side capture does not run.

**Rule location.**

- [`context-mill: context/commandments.yaml#astro-hybrid`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: example-apps/astro-hybrid/astro.config.mjs`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-hybrid/astro.config.mjs)
- [`context-mill: example-apps/astro-hybrid/src/pages/api/auth/login.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-hybrid/src/pages/api/auth/login.ts) api/events/burrito.ts

**Sources.** [PostHog/context-mill#73](https://github.com/PostHog/context-mill/pull/73), [PostHog/wizard-workbench#1265](https://github.com/PostHog/wizard-workbench/pull/1265)

**Frameworks.** `astro`

**Wrong:**

```typescript
// output: 'static' + node adapter
// src/pages/api/auth/login.ts
export const POST: APIRoute = async ({ request }) => {
  posthog.capture({ distinctId: username, event: 'server_login' });
}
```

**Fixed:**

```typescript
// astro.config.mjs: output 'static' (default) + adapter
export default defineConfig({ output: 'static', adapter: node({ mode: 'standalone' }) })
// src/pages/api/auth/login.ts
export const prerender = false;
export const POST: APIRoute = async ({ request }) => { /* capture */ }
```

## Astro files rewritten, frontmatter fence lost

**Problem.** Rewriting whole .astro files as if they were HTML or JSX drops the leading --- fence, and agents over-build layouts for a small change.

**Impact.** Pages break with confusing errors and the user must undo many edits.

**Rule location.**

- [`context-mill: context/commandments.yaml#astro`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (one posthog.astro component imported once in the Layout). No explicit rule preserves frontmatter fences
- [`context-mill: example-apps/astro-static/src/layouts/PostHogLayout.astro`](https://github.com/PostHog/context-mill/blob/main/example-apps/astro-static/src/layouts/PostHogLayout.astro) shows the target shape

**Sources.** [PostHog/wizard#153](https://github.com/PostHog/wizard/issues/153)

**Frameworks.** `astro`

**Wrong:**

```astro
import PostHog from '../components/posthog.astro';
<html>
  <head><PostHog /></head>
  <!-- opening and closing --- fences lost -->
```

**Fixed:**

```astro
---
import PostHog from '../components/posthog.astro';
---
<html><head><PostHog /></head>...
```

## SvelteKit relative asset paths break replay

**Problem.** paths.relative defaults to true, nothing in posthog-js setup mentions svelte.config.js, and nothing fails at build or runtime. Only replays of SSR pages render broken.

**Impact.** Silent: session replay loads assets from wrong relative URLs under SSR, so recordings render broken.

**Rule location.**

- [`context-mill: context/commandments.yaml#sveltekit`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: example-apps/sveltekit/svelte.config.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/sveltekit/svelte.config.js)
- [`context-mill: context/skills/posthog-best-practices/references/session-replay.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/session-replay.md)

**Sources.** [PostHog/context-mill#72](https://github.com/PostHog/context-mill/pull/72), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/wizard#248](https://github.com/PostHog/wizard/pull/248), [PostHog/wizard#261](https://github.com/PostHog/wizard/pull/261), [PostHog/wizard-workbench#4472](https://github.com/PostHog/wizard-workbench/pull/4472), [context-mill@06d960e](https://github.com/PostHog/context-mill/commit/06d960e5)

**Frameworks.** `sveltekit`

**Wrong:**

```javascript
// svelte.config.js
const config = {
  kit: {
    adapter: adapter(),
  },
};
```

**Fixed:**

```javascript
kit: {
  adapter: adapter(),
  // Required for PostHog session replay to work correctly with SSR
  paths: { relative: false }
}
```

## Svelte edits written from stale memory

**Problem.** Training data mixes Svelte 5 and older syntax, so the agent loops on compiler errors without docs or an autofixer.

**Impact.** Many wasted turns. The Svelte MCP cut over six minutes per integration.

**Rule location.**

- `wizard: src/frameworks/svelte/svelte-wizard-agent.ts` (additionalMcpServers)
- [`context-mill: context/commandments.yaml#sveltekit`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/wizard#261](https://github.com/PostHog/wizard/pull/261)

**Frameworks.** `sveltekit`

**Wrong:**

```text
Agent edits +layout.svelte from memory -> build fails -> edit -> build fails ...
(no Svelte docs, no svelte-autofixer)
```

**Fixed:**

```typescript
metadata: {
  additionalMcpServers: { svelte: { url: 'https://mcp.svelte.dev/mcp' } },
}
// rule: always run svelte-autofixer on new or modified .svelte files
```

## Angular service not a root singleton, reads process.env

**Problem.** Older Angular training data uses NgModules, constructor injection and component-level providers, and Node habits reach for process.env, which Angular does not provide in the browser.

**Impact.** Several service instances can init PostHog more than once, the code mismatches the standalone example, and env values are undefined at runtime.

**Rule location.**

- [`context-mill: context/commandments.yaml#angular`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (inject(), root singleton PosthogService, standalone, environment.ts rules)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (### Angular)
- [`context-mill: example-apps/angular/src/app/services/posthog.service.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/angular/src/app/services/posthog.service.ts)

**Sources.** [PostHog/context-mill#74](https://github.com/PostHog/context-mill/pull/74), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108)

**Frameworks.** `angular`

**Wrong:**

```typescript
@Injectable()
export class PostHogService { constructor() { posthog.init(process.env['POSTHOG_KEY']) } }

@Component({ providers: [PostHogService] })
export class AppComponent {
  constructor(private posthog: PostHogService) {}
}
```

**Fixed:**

```typescript
@Injectable({ providedIn: 'root' })
export class PostHogService { /* init once, keys from src/environments/environment.ts */ }

export class AppComponent {
  private posthogService = inject(PostHogService)   // inject(), standalone
}
```

## Angular init runs inside the zone

**Problem.** ngOnInit is the natural init spot and it works. The change-detection cost from replay's DOM observers is invisible.

**Impact.** Silent performance cost: session replay triggers extra change-detection cycles.

**Rule location.**

- posthog.com Angular docs only
- not encoded in context-mill (example-apps/angular init is not zone-wrapped)

**Sources.** [PostHog/wizard-workbench#1011](https://github.com/PostHog/wizard-workbench/pull/1011), [PostHog/wizard-workbench#3552](https://github.com/PostHog/wizard-workbench/pull/3552), [PostHog/wizard-workbench#4450](https://github.com/PostHog/wizard-workbench/pull/4450)

**Frameworks.** `angular`

**Wrong:**

```typescript
ngOnInit(): void {
  posthog.init(environment.posthogKey, { api_host: environment.posthogHost });
}
```

**Fixed:**

```typescript
this.ngZone.runOutsideAngular(() => {
  posthog.init(environment.posthogKey, {
    api_host: environment.posthogHost, defaults: '2026-01-30',
  });
});
```

## WordPress code put in theme functions.php

**Problem.** functions.php is the most common WordPress snippet target online, and PostHog's public WordPress docs show it, so it works until the theme changes.

**Impact.** Silent: a theme switch or update removes the integration, there is no clean home for server-side capture, and an unescaped token adds exposure.

**Rule location.**

- [`context-mill: context/commandments.yaml#wordpress`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (first rule)
- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) variant wordpress
- [`context-mill: example-apps/wordpress/posthog-example/posthog-example.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/wordpress/posthog-example/posthog-example.php)
- [`context-mill: example-apps/wordpress/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/wordpress/README.md) (Why a plugin, not functions.php)

**Sources.** [PostHog/context-mill#279](https://github.com/PostHog/context-mill/pull/279), [context-mill@87149b5](https://github.com/PostHog/context-mill/commit/87149b55)

**Frameworks.** `wordpress`, `php`

**Wrong:**

```php
// wp-content/themes/<active>/functions.php
add_action('wp_head', function () {
  echo "<script>posthog.init('" . POSTHOG_TOKEN . "')</script>";
});
```

**Fixed:**

```php
<?php
/**
 * Plugin Name: PostHog Example
 */
// wp-content/plugins/posthog-example/posthog-example.php
if (!defined('ABSPATH')) { exit; }
// token comes from the wp-config.php constant POSTHOG_PROJECT_TOKEN
// and is printed with esc_js(posthog_example_token())
add_action('wp_head', 'posthog_example_client_snippet', 999);
```

## WordPress plugin file runs without ABSPATH guard

**Problem.** The guard is a WordPress convention, not something PHP or the PostHog docs require, so agents writing a minimal plugin leave it out.

**Impact.** A direct request to the plugin file runs it without WordPress loaded, throwing on undefined functions and exposing errors.

**Rule location.**

- [`context-mill: context/commandments.yaml#wordpress`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (guard every plugin entry file with the ABSPATH check before any other code)
- [`context-mill: example-apps/wordpress/posthog-example/posthog-example.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/wordpress/posthog-example/posthog-example.php)

**Sources.** [PostHog/context-mill#279](https://github.com/PostHog/context-mill/pull/279)

**Frameworks.** `wordpress`

**Wrong:**

```php
<?php
/** Plugin Name: PostHog Example */
require __DIR__ . '/vendor/autoload.php';
use PostHog\PostHog;
PostHog::init($token);
add_action('wp_head', 'my_snippet'); // add_action undefined if hit directly
```

**Fixed:**

```php
<?php
/** Plugin Name: PostHog Example */
if (!defined('ABSPATH')) {
    exit;
}
require __DIR__ . '/vendor/autoload.php';
use PostHog\PostHog;
```

## WordPress pageviews captured from PHP

**Problem.** With the PHP SDK installed, capturing $pageview in a wp\_head hook looks simpler than adding a browser snippet, and page caching hides the gap.

**Impact.** Silent undercount: full-page-cached hits never run PHP, and uncached hits add server work to every render.

**Rule location.**

- [`context-mill: context/commandments.yaml#wordpress`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (capture pageviews with the client SDK, flush after capture)
- [`context-mill: example-apps/wordpress/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/wordpress/README.md) (Key Implementation Patterns 4 and 5)

**Sources.** [PostHog/context-mill#279](https://github.com/PostHog/context-mill/pull/279)

**Frameworks.** `wordpress`, `php`

**Wrong:**

```php
add_action('wp_head', function () {
    PostHog::capture(['distinctId' => $id, 'event' => '$pageview']);
});
```

**Fixed:**

```php
// pageviews: posthog-js snippet printed in wp_head
// server SDK only for real server actions
add_action('woocommerce_thankyou', function ($order_id) {
    PostHog::capture(['distinctId' => (string) $user_id, 'event' => 'order_completed']);
    PostHog::flush();
});
```

## TanStack Router provider in an unused root

**Problem.** TanStack Router has file-based and code-based modes, and most docs and training data show file-based, so the agent creates a src/routes/\_\_root.tsx that nothing imports.

**Impact.** Silent: the provider never mounts on the real root route, so no PostHog client is available to the app and nothing is captured.

**Rule location.**

- [`wizard: src/programs/frameworks/tanstack-router/utils.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/frameworks/tanstack-router/utils.ts) (getTanStackRouterMode) and tanstack-router-wizard-agent.ts (routerMode context, excludes @tanstack/react-start)
- [`context-mill: context/commandments.yaml#tanstack-router`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 169-171), example-apps/react-tanstack-router-code-based/src/main.tsx

**Sources.** [PostHog/wizard#252](https://github.com/PostHog/wizard/pull/252), [PostHog/context-mill#68](https://github.com/PostHog/context-mill/pull/68)

**Frameworks.** `tanstack-router`, `react`

**Wrong:**

```tsx
// code-based project: routes defined in main.tsx, no routeTree.gen.ts
// src/routes/__root.tsx  <- created by the agent, never imported
export const Route = createRootRoute({
  component: () => <PostHogProvider apiKey={key}><Outlet /></PostHogProvider>,
})
```

**Fixed:**

```tsx
// detect: routeTree.gen.ts | @tanstack/router-plugin | createFileRoute => file-based
//         createRoute( without createFileRoute => code-based
// main.tsx (code-based): wrap where createRootRoute() is actually called
const rootRoute = createRootRoute({ component: RootComponent })
function RootComponent() {
  return <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN!}
    options={{ api_host: '/ingest', defaults: '2026-01-30' }}>
    <Outlet />
  </PostHogProvider>
}
```

## Laravel 11 wired through old Kernel files

**Problem.** Most Laravel training data predates 11, which moved middleware and providers into bootstrap/app.php and removed Http/Kernel.php.

**Impact.** On Laravel 11+ edits target a missing or unused file, so PostHog middleware is never registered.

**Rule location.**

- [`wizard: src/programs/frameworks/laravel/laravel-wizard-agent.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/frameworks/laravel/laravel-wizard-agent.ts) (getAdditionalContextLines, laravelStructure, lines ~132-150)
- src/programs/frameworks/laravel/utils.ts (detectLaravelStructure, findLaravelBootstrapFile). No bootstrap/app.php rule in context-mill commandments#laravel

**Sources.** [PostHog/wizard#238](https://github.com/PostHog/wizard/pull/238), [wizard@fe5a220](https://github.com/PostHog/wizard/commit/fe5a220c)

**Frameworks.** `laravel`

**Wrong:**

```php
// app/Http/Kernel.php  (absent in Laravel 11+)
protected $middleware = [
    \App\Http\Middleware\PostHogMiddleware::class,
];
```

**Fixed:**

```php
// harness prompt lines, from composer version (major >= 11 => 'latest'):
//   'Laravel structure: latest (affects where to add configuration)'
//   'Note: Laravel 11+ uses simplified bootstrap/app.php for middleware and providers'
// resulting edit, bootstrap/app.php:
->withMiddleware(function (Middleware $middleware) {
    $middleware->append(\App\Http\Middleware\PostHogMiddleware::class);
})
```

## Laravel bare use Throwable breaks config:cache

**Problem.** 'use Throwable.' is a normal import in namespaced PHP, but bootstrap/app.php has no namespace, so PHP warns and Laravel turns the warning into an exception.

**Impact.** artisan config:cache fails and the container restarts in a loop.

**Rule location.** `context-mill: not` yet encoded (PR 416 body says it 'needs its own follow-up in the Laravel error-tracking guidance', not in commandments.yaml#laravel)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `laravel`, `php`

**Wrong:**

```php
<?php
use Throwable;   // no namespace in this file: warning -> ErrorException
->withExceptions(function (Exceptions $exceptions) {
    $exceptions->report(function (Throwable $e) {
        \PostHog\PostHog::captureException($e);
    });
})
```

**Fixed:**

```php
<?php
// no import; fully qualified name
->withExceptions(function (Exceptions $exceptions) {
    $exceptions->report(function (\Throwable $e) {
        \PostHog\PostHog::captureException($e);
    });
})
```

## Laravel env() calls and scattered capture

**Problem.** env() works in development, and only returns null after php artisan config:cache in production. Hooking model observers also looks like a tidy way to capture events.

**Impact.** In production init gets no token because env() returns null once config is cached. Scattered init and capture calls and observer hooks make events duplicate or fire from unintended places.

**Rule location.**

- [`context-mill: context/commandments.yaml#laravel`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (lines 178-182)
- [`context-mill: example-apps/laravel/app/Services/PostHogService.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/laravel/app/Services/PostHogService.php) config/posthog.php

**Sources.** [`context-mill: context/commandments.yaml#laravel`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml), [`context-mill: example-apps/laravel/app/Services/PostHogService.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/laravel/app/Services/PostHogService.php)

**Frameworks.** `laravel`

**Wrong:**

```php
// in every controller
PostHog::init(env('POSTHOG_PROJECT_TOKEN'), ['host' => env('POSTHOG_HOST')]);
PostHog::capture(['distinctId' => $user->id, 'event' => 'burrito_considered']);
// plus User::observe(...) for analytics
```

**Fixed:**

```php
// config/posthog.php: 'api_key' => env('POSTHOG_PROJECT_TOKEN', '')
// app/Services/PostHogService.php (constructor)
if (!self::$initialized) {
    PostHog::init(config('posthog.api_key'), ['host' => config('posthog.host')]);
    self::$initialized = true;
}
// callers: $posthog->capture($id, 'event', [...])
```

## Modern integration applied to ancient versions

**Problem.** Agents write current APIs and install the latest SDK regardless of the installed framework or platform version.

**Impact.** Code that does not build or run on the installed version. Build or boot fails.

**Rule location.**

- `wizard: src/programs/frameworks/*/*-wizard-agent.ts` (detection.minimumVersion: django 3.0.0, laravel 9.0.0, android 21.0.0, etc.)
- src/programs/detection/context.ts (version check)
- src/tui/programs/posthog-integration/screens/PostHogIntegrationIntroScreen.tsx (unsupported view)

**Sources.** [PostHog/wizard#230](https://github.com/PostHog/wizard/pull/230), [PostHog/wizard#238](https://github.com/PostHog/wizard/pull/238), [PostHog/wizard#262](https://github.com/PostHog/wizard/pull/262)

**Frameworks.** `django`, `laravel`, `android`

**Wrong:**

```kotlin
// app/build.gradle.kts of an existing app
defaultConfig {
    minSdk = 19
}
dependencies {
    implementation("com.posthog:posthog-android:3.+")  // agent adds it anyway
}
```

**Fixed:**

```typescript
// android-wizard-agent.ts
minimumVersion: '21.0.0',
getInstalledVersion: (options) => getMinSdkVersion(options),
// intro screen: "Version 19 is not supported by the wizard. Please
//  upgrade to 21.0.0 or later." + manual setup guide link + pick another framework
```

## Framework version read from package.json range

**Problem.** Coercing the declared range is the obvious way to read a version, but the range floor differs from what node\_modules actually resolved.

**Impact.** Version gates and version-specific guidance use the wrong number. A project with next ^15.1.0 and 15.5.9 installed was refused as below the 15.3.0 minimum.

**Rule location.**

- wizard (main): src/shared/utils/package-json.ts#getInstalledPackageVersion
- src/programs/detection/context.ts#checkFrameworkVersion
- each framework's detection.getInstalledVersion in src/programs/frameworks/\*/

**Sources.** [PostHog/wizard#332](https://github.com/PostHog/wizard/pull/332), [PostHog/wizard#334](https://github.com/PostHog/wizard/pull/334)

**Frameworks.** `nextjs`, `react-router`, `tanstack-router`, `tanstack-start`, `vue`, `nuxt`, `angular`, `astro`, `react-native`

**Wrong:**

```ts
const range = pkg.dependencies.next;  // "^15.1.0"
const v = semver.coerce(range);       // 15.1.0, node_modules has 15.5.9
if (semver.lt(v, '15.3.0')) {
  abort('Unsupported Next.js version');
}
```

**Fixed:**

```ts
export function getInstalledPackageVersion(name: string, installDir: string) {
  try {
    const p = path.join(installDir, 'node_modules', name, 'package.json');
    return JSON.parse(readFileSync(p, 'utf-8')).version; // e.g. 15.5.9
  } catch { return undefined; } // unknown version passes the gate
}
```

## PostHog client built inside ASP.NET controllers

**Problem.** Generic SDK quickstarts show constructing a client directly, the shortest working code. The PostHog.AspNetCore DI registration is less known.

**Impact.** One client and queue per controller instance, unflushed batches, hardcoded secrets, and the PostHog config section and env fallbacks bypassed.

**Rule location.** [`context-mill: context/commandments.yaml#aspnetcore`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #dotnet

**Sources.** [PostHog/context-mill#145](https://github.com/PostHog/context-mill/pull/145)

**Frameworks.** `dotnet`, `aspnetcore`

**Wrong:**

```csharp
public class OrdersController : Controller
{
    private readonly PostHogClient _ph =
        new PostHogClient(new PostHogOptions { ProjectToken = "phc_..." });
}
```

**Fixed:**

```csharp
builder.AddPostHog(); // PostHog section or POSTHOG_PROJECT_TOKEN / POSTHOG_HOST

public class OrdersController(IPostHogClient posthog) : Controller { }
```

## Full-stack apps get browser metrics SDK

**Problem.** A Next.js or Nuxt app reads as 'a JavaScript app', so the agent picks posthog-js, but metrics are meant to measure server work.

**Impact.** Requests, jobs and external calls go unmeasured. Metrics describe the browser.

**Rule location.**

- [`context-mill: context/agents/metrics/verify-sdk.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/metrics/verify-sdk.md) (Goal section)
- variants in context/skills/metrics/config.yaml (javascript vs nodejs)

**Sources.** [PostHog/context-mill#355](https://github.com/PostHog/context-mill/pull/355)

**Frameworks.** `nextjs`, `nuxt`, `sveltekit`, `astro`, `react-router`, `tanstack-start`

**Wrong:**

```text
# Next.js app -> install_skill metrics-javascript (posthog-js)
posthog.metrics.count("button.clicks")   // runs in the browser
```

**Fixed:**

```text
# context/agents/metrics/verify-sdk.md
install_skill for the variant matching the project's platform -- the menu
is the source of truth, one variant per platform, and a full-stack app
takes the server variant because metrics measure service work.
```

## Server log exporter added to browser app

**Problem.** Asked for logs, the agent installs the OTLP exporter wherever code runs, without checking the app is client-only.

**Impact.** Server exporter packages and credentials ship to the browser or break the bundle.

**Rule location.**

- [`context-mill: context/agents/integration-v2/logs.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/logs.md) (lines 24-26)
- [`context-mill: context/skills/integration/references/2-edit.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/2-edit.md) (logs step: 'Do not add a server exporter to browser-only code', skip with the reason)

**Sources.** [PostHog/context-mill#390](https://github.com/PostHog/context-mill/pull/390)

**Frameworks.** `vite`, `react`, `vue`

**Wrong:**

```typescript
// Vite SPA, src/main.tsx (no server)
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
// server exporter + project token in browser-only code
```

**Fixed:**

```text
A browser-only app must not receive a server exporter. If no documented
setup applies, complete as `not needed` and explain why.
```

## MCP SDK v2 servers rejected at detection

**Problem.** Training data knows only @modelcontextprotocol/sdk. V2 projects depend on @modelcontextprotocol/server and /core instead.

**Impact.** v2 projects are turned away before any reference doc is read, or emitted code branches on SDK major.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 1, Path A, v1/v2 sections)

**Sources.** [PostHog/context-mill#344](https://github.com/PostHog/context-mill/pull/344)

**Frameworks.** `mcp-typescript-sdk`

**Wrong:**

```text
// package.json has @modelcontextprotocol/server, no @modelcontextprotocol/sdk
[ABORT] no mcp server found
```

**Fixed:**

```typescript
// v2 signals: @modelcontextprotocol/server | /core | /client
import { McpServer } from "@modelcontextprotocol/server"
const analytics = instrument(server, posthog) // identical call on both majors
```

## Hand-rolled captures in an MCP server's tool handlers

**Problem.** Without knowing @posthog/mcp exists, the agent adds posthog.capture to each tool handler, and doesn't stop when there is no MCP server.

**Impact.** No $mcp\_\* events or agent intent, behavior changes inside tool handlers, and edits to projects that have no MCP server.

**Rule location.**

- [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (Scope and guardrails, Abort cases)
- wizard (main): src/programs/mcp-analytics/index.ts (MCP\_ANALYTICS\_ABORT\_CASES, was src/lib/programs/ in older checkouts)

**Sources.** [PostHog/wizard#731](https://github.com/PostHog/wizard/pull/731)

**Frameworks.** `mcp`, `javascript_node`, `python`

**Wrong:**

```ts
server.registerTool("search", schema, async (args) => {
  posthog.capture({ distinctId: "mcp", event: "search_called", properties: args });
  return runSearch(args);
});
```

**Fixed:**

```ts
const server = new McpServer({ name: "my-mcp-server", version: "1.0.0" })
// wrap once, right after constructing it; do not restructure tool handlers
const analytics = instrument(server, posthog, { captureModel: true })
// no MCP server found -> emit `[ABORT] no mcp server found` and stop
```

## MCP analytics wrapped around unsupported servers

**Problem.** Asked to add MCP analytics, the agent wraps any MCP server, even one on a third-party library or an old runtime the PostHog MCP SDK cannot wrap.

**Impact.** Broken or non-compiling instrumentation, and the wrong install package per language.

**Rule location.**

- [`wizard: src/programs/mcp-analytics/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/mcp-analytics/index.ts) (MCP\_ANALYTICS\_ABORT\_CASES, customPrompt)
- context-mill PR #419 (open) adds the matching \[ABORT\] reasons to context/skills/mcp-analytics/description.md

**Sources.** [PostHog/wizard#1424](https://github.com/PostHog/wizard/pull/1424), [PostHog/context-mill#419](https://github.com/PostHog/context-mill/pull/419)

**Frameworks.** `go`, `ruby`, `typescript`, `python`

**Wrong:**

```go
// go.mod: go 1.22, github.com/mark3labs/mcp-go (not the official go-sdk)
import (
  posthogmcp "github.com/posthog/posthog-go/mcp"
  "github.com/posthog/posthog-go/posthogmcpsdk"
)
// posthogmcpsdk.Instrument expects the official go-sdk *mcp.Server
posthogmcpsdk.Instrument(server, posthogmcp.New(client))
```

**Fixed:**

```typescript
match: /^go mcp server is not built on the official go-sdk$/i
match: /^go toolchain older than 1\.25$/i
match: /^ruby mcp server is not built on the official mcp gem$/i
match: /^ruby older than 3\.0$/i
match: /^ruby mcp gem older than 1\.4$/i
// abort with a clear message; the Ruby prompt says the SDK is experimental
```

## Debug logging corrupts a stdio MCP server

**Problem.** console.log or print() is the reflex for confirming setup, but on a stdio MCP server stdout is the protocol channel.

**Impact.** Stray output corrupts the MCP stream and breaks the client connection.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 6 'STDIO transports specifically', Key principles: Don't break STDIO)

**Sources.** [PostHog/context-mill#202](https://github.com/PostHog/context-mill/pull/202), [PostHog/context-mill#205](https://github.com/PostHog/context-mill/pull/205), [`wizard-workbench: apps/mcp-analytics/typescript-sdk/stdio-server/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/mcp-analytics/typescript-sdk/stdio-server/README.md)

**Frameworks.** `mcp`, `node`, `python`

**Wrong:**

```python
analytics = instrument(server, posthog)
print("PostHog MCP analytics enabled")   # stdout = the MCP channel
```

**Fixed:**

```python
# never print() to stdout on STDIO; route SDK warnings to stderr or a file
MCPAnalyticsOptions(logger=lambda m: print(m, file=sys.stderr))
# JS: no console.log; pass a `logger` to instrument() that writes to stderr
```

## NestJS MCP server has no constructor to wrap

**Problem.** The agent looks for new McpServer(...), but @rekog/mcp-nest builds the server inside McpModule, and returning instrument()'s handle from serverMutator replaces the server.

**Impact.** No insertion point is found, or the module receives the analytics handle instead of the server and breaks.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (Path D, STEP 4)

**Sources.** [PostHog/context-mill#204](https://github.com/PostHog/context-mill/pull/204)

**Frameworks.** `nestjs`, `@rekog/mcp-nest`

**Wrong:**

```ts
// no `new McpServer(...)` in user code: McpModule builds it
McpModule.forRoot({
  serverMutator: (server) => instrument(server, posthog), // returns the handle
})
```

**Fixed:**

```ts
import { PostHog, instrumentMutator } from "@posthog/mcp"

McpModule.forRoot({
  name: "my-mcp-server",
  version: "1.0.0",
  serverMutator: instrumentMutator(posthog),  // instruments and returns the server
})
```

## Python LLM apps miss LLM analytics

**Problem.** Feature detection and agents look at package.json for openai/anthropic, so a Python app's requirements.txt or pyproject is never checked. Nothing errors. The LLM calls just stay plain.

**Impact.** LLM calls are uninstrumented: no tokens, cost, latency or traces, and the agent hand-rolls a generic capture instead.

**Rule location.**

- [`wizard: src/programs/detection/features.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/detection/features.ts) (PYTHON\_LLM\_PACKAGES, parseRequirementsTxt, parsePyprojectToml, parsePipfile)
- [`context-mill: context/skills/ai-observability/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/description.md)

**Sources.** [PostHog/wizard#424](https://github.com/PostHog/wizard/pull/424)

**Frameworks.** `python`, `django`, `flask`, `fastapi`

**Wrong:**

```python
from openai import OpenAI
client = OpenAI()                            # untouched
posthog.capture(user_id, "chat_completed")  # no tokens or cost
```

**Fixed:**

```python
from posthog.ai.openai import OpenAI  # drop-in wrapper
client = OpenAI(posthog_client=posthog)
client.chat.completions.create(model=m, messages=msgs,
    posthog_distinct_id=user_id, posthog_trace_id=turn_id)
```

## Go LLM calls hand-captured with core SDK

**Problem.** There is no PostHog wrapper for Go AI clients, so the agent reaches for posthog-go and hand-rolls $ai\_generation events.

**Impact.** Events lack trace structure, and client lifecycle rules get applied where no client should exist.

**Rule location.**

- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (AI Observability carve-out, Go OTel)
- [`context-mill: context/skills/ai-observability/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/1-begin.md) (rule 1)

**Sources.** [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373)

**Frameworks.** `go`

**Wrong:**

```go
go get github.com/posthog/posthog-go
client, _ := posthog.NewWithConfig(key, posthog.Config{Endpoint: host})
client.Enqueue(posthog.Capture{DistinctId: id, Event: "$ai_generation"})
```

**Fixed:**

```go
// opentelemetry-go variant: nested module, no PostHog client
go get github.com/posthog/posthog-go/otel go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk
// register the PostHog span processor on the app's tracer provider
```

## go.mod alone routes a polyglot repo to Go

**Problem.** The agent treats any go.mod as proof the LLM calls are made from Go, without finding the call sites.

**Impact.** A Node or Python LLM app beside a Go service gets the Go variant and no instrumentation on the real calls.

**Rule location.** [`context-mill: context/skills/ai-observability/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/1-begin.md) (rule 1, 'Model calls made from Go take OpenTelemetry')

**Sources.** [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373)

**Frameworks.** `go`, `node`, `python`

**Wrong:**

```text
repo: go.mod (infra service) + package.json (openai calls)
agent picks: opentelemetry-go
```

**Fixed:**

```text
1. Model calls made from Go take OpenTelemetry (opentelemetry-go).
A go.mod on its own is not the signal.
Also a package.json / pyproject.toml / requirements.txt? Find the call sites before you route.
A Go service beside a Node or Python LLM app takes the rules below. Still unclear -> wizard_ask.
```

## Provider instrumented instead of the agent framework

**Problem.** The agent matches the first familiar provider package like openai or @google/genai and instruments it, missing the agent framework built on top, especially when the framework table never mentioned it (ADK).

**Impact.** Model calls are kept but agent, tool and handoff structure is lost. The framework's own tracing hook is never used.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/1-begin.md) (rule 2, framework table)
- references/3-instrument.md ('Swap the client' section)
- variant google-adk added to config.yaml in #375

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [PostHog/context-mill#375](https://github.com/PostHog/context-mill/pull/375), [PostHog/wizard#922](https://github.com/PostHog/wizard/pull/922), [`context-mill: context/skills/ai-observability/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/1-begin.md)

**Frameworks.** `openai-agents`, `claude-agent-sdk`, `langchain`, `langgraph`, `crewai`, `mastra`, `pydantic-ai`, `google-adk`

**Wrong:**

```python
# manifest has openai-agents, which wraps openai
from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor
OpenAIInstrumentor().instrument()
# package.json: "@google/adk", "@google/genai" -> wraps only the genai client
```

**Fixed:**

```text
Rule 2: a framework wins over the provider under it.
| openai-agents | variant `openai-agents` |
| langgraph     | variant `langgraph-{python,node}` |
| `@google/adk` | variant `google-adk` |
Instrument the framework, not the provider below it.
Step 3: agent frameworks use their own tracing hook from the install doc.
Do not substitute an OTel instrumentor.
```

## AI framework in manifest but not making the calls

**Problem.** Applying 'framework wins over provider' from the manifest alone picks llama-index or langchain even when it is only a vector store or eval side path.

**Impact.** Only the side path is instrumented. The real provider calls are missed and the project gets few or no generation events.

**Rule location.** [`context-mill: context/skills/ai-observability/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/1-begin.md) (rule 2, paragraph after the framework table)

**Sources.** [PostHog/context-mill#398](https://github.com/PostHog/context-mill/pull/398)

**Frameworks.** `llamaindex`, `langchain`, `openai`, `anthropic`

**Wrong:**

```text
requirements: llama-index (vector store provider only), openai==0.27.5
-> agent applies rule "framework wins over provider"
-> variant llamaindex + OTel, wraps only the datastore
-> services/llm.py raw openai calls stay uninstrumented
```

**Fixed:**

```text
The framework wins only when it carries the app's generations.
Open the generation call sites before routing.
Direct provider SDK makes the primary calls -> route by that provider.
Both carry real generations -> wizard_ask with each as an option.
```

## OpenAI-compatible gateway routed as plain OpenAI

**Problem.** The manifest shows only the openai package. The real provider is visible only in the client's base\_url or OPENAI\_BASE\_URL.

**Impact.** Install shape matches but the provider is wrong, so events are labelled and priced as OpenAI.

**Rule location.** [`context-mill: context/skills/ai-observability/references/1-begin.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/1-begin.md) (rule 3, 'An openai client with a base URL override means a gateway')

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [PostHog/posthog-python#822](https://github.com/PostHog/posthog-python/pull/822), [PostHog/wizard-workbench#3358](https://github.com/PostHog/wizard-workbench/pull/3358), [`wizard-workbench: apps/ai-observability/groq/node-chat/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/groq/node-chat/README.md)

**Frameworks.** `groq`, `openrouter`, `together`, `ollama`

**Wrong:**

```python
client = OpenAI(base_url='https://api.groq.com/openai/v1',
                api_key=os.environ['GROQ_API_KEY'])
# agent: manifest has `openai` -> install ai-observability-openai-python
```

**Fixed:**

```text
Rule 3: an `openai` client with a base URL override means a gateway.
Check the client constructor and OPENAI_BASE_URL (api.groq.com, openrouter.ai,
api.together.xyz, localhost:11434). Pick the variant that names the provider.
```

## Phoenix PostHog Plug missing or after router

**Problem.** Adding the Hex dependency and capture calls looks complete, so the agent skips the Plug or appends it after the router, where it is never reached. Nothing errors.

**Impact.** Request metadata ($current\_url, $host, $pathname) and the X-PostHog-Distinct-Id / Session-Id tracing headers never reach events and errors, so backend and frontend persons do not link.

**Rule location.**

- [`context-mill: context/commandments.yaml#elixir`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: example-apps/elixir/lib/posthog_example_web/endpoint.ex`](https://github.com/PostHog/context-mill/blob/main/example-apps/elixir/lib/posthog_example_web/endpoint.ex)
- `wizard: src/frameworks/elixir/elixir-wizard-agent.ts` (isPhoenixProject, getAdditionalContextLines)

**Sources.** [PostHog/context-mill#154](https://github.com/PostHog/context-mill/pull/154), [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268), [PostHog/wizard#946](https://github.com/PostHog/wizard/pull/946)

**Frameworks.** `elixir`, `phoenix`, `plug`

**Wrong:**

```elixir
# endpoint.ex
plug Plug.Session, @session_options
plug MyAppWeb.Router
plug PostHog.Integrations.Plug # never reached
```

**Fixed:**

```elixir
# endpoint.ex: before the router, wraps every request in a PostHog context
plug Plug.Session, @session_options
plug PostHog.Integrations.Plug
plug MyAppWeb.Router
```

## React Native provider wraps NavigationContainer

**Problem.** Wrapping the whole app in the provider is the normal React pattern, but the SDK's screen hook needs react-navigation hooks, which fail outside the container with only a console error.

**Impact.** Screen views are never captured on React Navigation v7.

**Rule location.**

- [`context-mill: context/commandments.yaml#react-native`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('Place PostHogProvider INSIDE NavigationContainer for React Navigation v7 compatibility')
- [`context-mill: example-apps/react-native/App.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-native/App.tsx)

**Sources.** [PostHog/context-mill#75](https://github.com/PostHog/context-mill/pull/75), [`posthog-js: packages/react-native/src/hooks/useNavigationTracker.ts`](https://github.com/PostHog/posthog-js/blob/HEAD/packages/react-native/src/hooks/useNavigationTracker.ts), [context-mill@d2c2dda](https://github.com/PostHog/context-mill/commit/d2c2dda2), [posthog.com/docs/libraries/react-native](https://posthog.com/docs/libraries/react-native)

**Frameworks.** `react-native`

**Wrong:**

```tsx
<PostHogProvider client={posthog} autocapture={{ captureScreens: true }}>
  <NavigationContainer>
    <RootNavigator />
  </NavigationContainer>
</PostHogProvider>
```

**Fixed:**

```tsx
<NavigationContainer ref={navigationRef} onStateChange={() => {
  const current = navigationRef.current?.getCurrentRoute()?.name
  if (current && current !== routeNameRef.current)
    posthog.screen(current, { previous_screen: routeNameRef.current })
  routeNameRef.current = current }}>
  <PostHogProvider client={posthog} autocapture={{ captureScreens: false, captureTouches: true }}>
    <RootNavigator />
  </PostHogProvider>
</NavigationContainer>
```

## Expo Router screens never tracked

**Problem.** The agent expects PostHogProvider autocapture to emit $screen events, but Expo Router has no NavigationContainer for the SDK to observe.

**Impact.** $screen events are silently missing for route changes. The wizard's own example spreads route params into the event, with a comment to filter sensitive values.

**Rule location.**

- [`context-mill: context/commandments.yaml#expo`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 271)
- [`context-mill: example-apps/expo/app/_layout.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/expo/app/_layout.tsx)

**Sources.** [PostHog/context-mill#75](https://github.com/PostHog/context-mill/pull/75), [context-mill@d2c2dda](https://github.com/PostHog/context-mill/commit/d2c2dda2), [PostHog/wizard-workbench#4402](https://github.com/PostHog/wizard-workbench/pull/4402), [PostHog/wizard-workbench#4469](https://github.com/PostHog/wizard-workbench/pull/4469)

**Frameworks.** `expo`, `react-native`

**Wrong:**

```tsx
// app/_layout.tsx
<PostHogProvider client={posthog} autocapture>
  <Stack />
</PostHogProvider>
// no posthog.screen() anywhere
```

**Fixed:**

```tsx
const pathname = usePathname()
const params = useGlobalSearchParams()
useEffect(() => {
  if (previousPathname.current !== pathname) {
    posthog.screen(pathname, { previous_screen: previousPathname.current ?? null, ...params })
    previousPathname.current = pathname
  }
}, [pathname, params]) // provider autocapture: { captureScreens: false }
```

## Expo and bare React Native set up alike

**Problem.** Both use posthog-react-native, so the agent applies one recipe to both, reaching for process.env, npm install, react-native-config or pod install, which do not work the same in managed Expo.

**Impact.** The token is undefined at runtime so analytics are silently disabled, native versions mismatch, native steps run that don't exist in Expo, or pods are never installed in bare RN.

**Rule location.**

- [`wizard: src/programs/frameworks/react-native/utils.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/frameworks/react-native/utils.ts) (detectReactNativeVariant), react-native-wizard-agent.ts
- [`context-mill: context/commandments.yaml#react-native`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #expo
- [`context-mill: example-apps/expo/src/config/posthog.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/expo/src/config/posthog.ts)

**Sources.** [PostHog/wizard#268](https://github.com/PostHog/wizard/pull/268), [wizard@e87a903](https://github.com/PostHog/wizard/commit/e87a9030)

**Frameworks.** `react-native`, `expo`

**Wrong:**

```bash
# Expo project (expo in package.json, no ios/ directory)
$ npm install posthog-react-native react-native-config
$ cd ios && pod install   # no ios/ in managed Expo
const key = process.env.POSTHOG_API_KEY  // not inlined
```

**Fixed:**

```typescript
// Expo: npx expo install posthog-react-native
// EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN or app.config.js extras (NOT react-native-config)
const projectToken = Constants.expoConfig?.extra?.posthogProjectToken
// bare RN: Config.POSTHOG_PROJECT_TOKEN (react-native-config), then npx pod-install
```

## No pageviews for in-app navigation without a router

**Problem.** Default pageview capture looks like it covers navigation, but a state-driven SPA never changes the URL, so only the first load counts.

**Impact.** Only the initial load produces a $pageview. Later in-app page changes are never counted.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 57)
- [`context-mill: example-apps/react-vite/src/components/Header.jsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-vite/src/components/Header.jsx)

**Sources.** [PostHog/context-mill#92](https://github.com/PostHog/context-mill/pull/92), [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83)

**Frameworks.** `react-vite`, `javascript_web`

**Wrong:**

```js
posthog.init(key, { api_host: host })
const navigate = (target) => setPage(target)   // no $pageview
```

**Fixed:**

```js
const navigate = (target) => {
  setPage(target)
  posthog.capture('$pageview', { $current_url: `/${target}` })
}
// History API routing instead: capture_pageview: 'history_change'
```

## Nuxt module chosen without checking minor version

**Problem.** Nuxt 3.0-3.6 and 3.7+/4 look alike, but @posthog/nuxt only supports 3.7+. Current docs lead with the module, so agents either always install it or always hand-roll a plugin.

**Impact.** On 3.0-3.6 the module fails to load or never initializes and source-map settings do nothing. On 3.7+/4 a hand-rolled plugin loses built-in client and Nitro exception capture and source-map upload.

**Rule location.**

- [`context-mill: context/skills/integration/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/config.yaml) (nuxt-3-6, nuxt-4)
- [`context-mill: example-apps/nuxt-4`](https://github.com/PostHog/context-mill/tree/main/example-apps/nuxt-4) example-apps/nuxt-3-6/README.md and nuxt.config.ts

**Sources.** [PostHog/context-mill#62](https://github.com/PostHog/context-mill/pull/62), [PostHog/context-mill#64](https://github.com/PostHog/context-mill/pull/64), [PostHog/wizard-workbench#4401](https://github.com/PostHog/wizard-workbench/pull/4401)

**Frameworks.** `nuxt`

**Wrong:**

```typescript
// nuxt.config.ts (Nuxt 3.5)
export default defineNuxtConfig({
  modules: ['@posthog/nuxt'],
  posthogConfig: {
    publicKey: process.env.NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    sourcemaps: { enabled: true },
  },
})
// or: Nuxt 4 app with a hand-rolled plugins/posthog.client.ts
```

**Fixed:**

```typescript
// Nuxt 3.7+ / 4
export default defineNuxtConfig({
  modules: ['@posthog/nuxt'],
  posthogConfig: {
    publicKey: process.env.NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN || '',
    host: process.env.NUXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
  },
})
// Nuxt 3.0-3.6: runtimeConfig + plugins/posthog.client.ts (posthog-js) + posthog-node
```

## Replay vision run on backend-only apps

**Problem.** Asked to set up or scan session replay, the agent complies on an API that serves no pages, installing posthog-js into it, or on a KMP project with no replay support, instead of recognising there are no recordings.

**Impact.** A wasted agent run and a false 'configured' report. Before #1138 the clean abort also filed an error-tracking issue on every run.

**Rule location.**

- [`wizard: src/programs/replay-vision/index.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/replay-vision/index.ts) (abortUnsupportedPlatform, gate in DETECT step)
- REPLAY\_VISION\_SUPPORTED in src/shared/constants (@shared/constants)

**Sources.** [PostHog/wizard#1138](https://github.com/PostHog/wizard/pull/1138), [`wizard-workbench: apps/replay-vision/javascript-node/inventory-api/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/replay-vision/javascript-node/inventory-api/README.md), [PostHog/context-mill#341](https://github.com/PostHog/context-mill/pull/341), [PostHog/context-mill#343](https://github.com/PostHog/context-mill/pull/343), [PostHog/wizard-workbench#3504](https://github.com/PostHog/wizard-workbench/pull/3504)

**Frameworks.** `javascript_node`, `python`, `ruby`, `kmp`

**Wrong:**

```typescript
// Express JSON API, no pages served
import posthog from 'posthog-js'
posthog.init(token, { session_recording: { maskAllInputs: true } })
```

**Fixed:**

```typescript
// src/programs/replay-vision/index.ts: platform gate before any agent work
if (!REPLAY_VISION_SUPPORTED.has(integration)) {
  abortUnsupportedPlatform(integration)
}
// "Session replay isn't available for Node.js projects..."
// zero diff, analytics.wizardCapture event, not captureException
```

## Browser snippet added to an API-only Rails app

**Problem.** 'Add PostHog to Rails' usually means a layout snippet, so the agent adds one, and even creates a layout file, when config.api\_only = true and no views exist.

**Impact.** Dead frontend code and an unrequested view layer, while the real backend integration may be skipped.

**Rule location.**

- [`wizard: src/programs/frameworks/rails/utils.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/frameworks/rails/utils.ts) (getRailsProjectType)
- rails-wizard-agent.ts (getAdditionalContextLines)

**Sources.** [PostHog/wizard#276](https://github.com/PostHog/wizard/pull/276), [wizard@26ac00d](https://github.com/PostHog/wizard/commit/26ac00d3), [PostHog/context-mill#85](https://github.com/PostHog/context-mill/pull/85)

**Frameworks.** `rails`

**Wrong:**

```erb
# config/application.rb: config.api_only = true
# agent creates app/views/layouts/application.html.erb
<script>!function(t,e){...}(document,window.posthog||[]); posthog.init('<token>')</script>
```

**Fixed:**

```ts
if (context.projectType === RailsProjectType.API) {
  lines.push('Note: This is an API-only Rails app — skip frontend posthog-js integration');
}
// detected via 'config.api_only = true' in config/application.rb
// backend only: posthog-rails initializer, PostHog.capture in controllers/jobs
```

## Rails integrated like a plain Ruby script

**Problem.** The posthog-ruby README shows PostHog::Client.new, so the agent builds a global client with at\_exit instead of using the posthog-rails gem and PostHog.init.

**Impact.** No automatic controller exception capture, user context or ActiveJob instrumentation, and possibly multiple client lifecycles beside Rails.

**Rule location.**

- [`context-mill: context/commandments.yaml#ruby-on-rails`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: example-apps/ruby-on-rails/config/initializers/posthog.rb`](https://github.com/PostHog/context-mill/blob/main/example-apps/ruby-on-rails/config/initializers/posthog.rb)
- [`wizard: src/programs/frameworks/ruby/utils.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/frameworks/ruby/utils.ts) (isRubyProject excludes Rails)

**Sources.** [PostHog/context-mill#85](https://github.com/PostHog/context-mill/pull/85), [PostHog/wizard#276](https://github.com/PostHog/wizard/pull/276)

**Frameworks.** `rails`, `ruby`

**Wrong:**

```ruby
# config/initializers/posthog.rb
$posthog = PostHog::Client.new(api_key: ENV['POSTHOG_PROJECT_TOKEN'])
at_exit { $posthog.shutdown }
# controller
$posthog.capture(distinct_id: user.id.to_s, event: 'signed_up')
```

**Fixed:**

```ruby
# Gemfile: gem 'posthog-ruby'; gem 'posthog-rails'
PostHog.init do |config|
  config.api_key = ENV.fetch('POSTHOG_PROJECT_TOKEN', nil)
  config.host = ENV.fetch('POSTHOG_HOST', 'https://us.i.posthog.com')
end
PostHog::Rails.configure do |config|
  config.auto_capture_exceptions = true
  config.auto_instrument_active_job = true
  config.capture_user_context = true
end
```

## Server-rendered app gets no browser snippet

**Problem.** In a Rails or Laravel app the server SDK feels like the full integration, since there is no separate frontend package to install, and the agent forgets the views render a browser app.

**Impact.** No pageviews, autocapture, session replay or client-side errors. Only backend events arrive.

**Rule location.**

- [`context-mill: context/commandments.yaml#ruby-on-rails`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (last bullet, 'For frontend tracking alongside posthog-rails')
- [`context-mill: example-apps/ruby-on-rails/app/views/layouts/application.html.erb`](https://github.com/PostHog/context-mill/blob/main/example-apps/ruby-on-rails/app/views/layouts/application.html.erb)

**Sources.** [PostHog/context-mill#85](https://github.com/PostHog/context-mill/pull/85)

**Frameworks.** `rails`, `laravel`

**Wrong:**

```text
# Gemfile: posthog-ruby, posthog-rails
# diff touches only config/initializers/posthog.rb and controllers
# app/views/layouts/application.html.erb unchanged
```

**Fixed:**

```erb
<%# app/views/layouts/application.html.erb, in <head> %>
<script>
  !function(t,e){/* posthog-js snippet */}(document,window.posthog||[]);
  posthog.init('<%= ENV["POSTHOG_PROJECT_TOKEN"] %>', {
    api_host: '<%= ENV.fetch("POSTHOG_HOST", "https://us.i.posthog.com") %>',
  })
</script>
```

## Stock snippet crashes when toString is read-only

**Problem.** The agent pastes the stock posthog-js snippet verbatim. It works on most sites and fails only in strict mode on pages that freeze Array.prototype.toString.

**Impact.** The direct assignment throws, so PostHog never initialises, with no visible sign in the integration.

**Rule location.**

- [`context-mill: scripts/generate-browser-snippets.js`](https://github.com/PostHog/context-mill/blob/main/scripts/generate-browser-snippets.js)
- [`context-mill: example-apps/ruby-on-rails/app/views/layouts/application.html.erb`](https://github.com/PostHog/context-mill/blob/main/example-apps/ruby-on-rails/app/views/layouts/application.html.erb) (POSTHOG\_BROWSER\_SNIPPET\_START/END)

**Sources.** [PostHog/context-mill#382](https://github.com/PostHog/context-mill/pull/382), [context-mill@6149f9d](https://github.com/PostHog/context-mill/commit/6149f9d6), [PostHog/posthog#94098](https://github.com/PostHog/posthog/pull/94098)

**Frameworks.** `ruby-on-rails`, `astro`, `flutter`, `wordpress`, `javascript_web`

**Wrong:**

```js
u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},
u.people.toString=function(){return u.toString(1)+".people (stub)"}
```

**Fixed:**

```js
Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,
  value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),
Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,
  value:function(){return u.toString(1)+".people (stub)"}})
```

## PostHogProvider assumed in non-React frameworks

**Problem.** Most PostHog examples the agent has seen are React, so it plans around a provider wrapper even in Vue, Svelte, Astro or Django.

**Impact.** Non-React integrations get a made-up provider concept in code, todo labels and status messages.

**Rule location.** [`wizard: src/agent/commandments.ts`](https://github.com/PostHog/wizard/blob/main/src/agent/commandments.ts) (WIZARD\_COMMANDMENTS)

**Sources.** [PostHog/wizard#339](https://github.com/PostHog/wizard/pull/339)

**Frameworks.** `vue`, `svelte`, `astro`, `django`, `all non-React`

**Wrong:**

```text
- [ ] Add PostHogProvider to the root layout   // Vue, Svelte, Astro or Django app
status: "Wrapping the app in PostHogProvider"
```

**Fixed:**

```text
Do not assume "PostHog provider" or "PostHogProvider" in task labels,
status messages, or code. Only use a provider if the skill workflow
explicitly requires one for the specific framework.
```

## Workers runtime hidden behind a framework adapter

**Problem.** An Astro, SvelteKit or React Router app looks like a Node SSR app. Only the adapter package or wrangler config reveals it runs on Workers.

**Impact.** Node-shaped code (process.env, shared batching client, no waitUntil) runs on Workers, so env values are missing and events are dropped.

**Rule location.**

- [`wizard: src/programs/cloudflare-detection.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/cloudflare-detection.ts) (module exists on main but has no callers since #385 removed the runner wiring)
- [`context-mill: context/docs.yaml#cloudflare-workers`](https://github.com/PostHog/context-mill/blob/main/context/docs.yaml)

**Sources.** [PostHog/wizard#370](https://github.com/PostHog/wizard/pull/370), [PostHog/context-mill#104](https://github.com/PostHog/context-mill/pull/104), [PostHog/wizard#385](https://github.com/PostHog/wizard/pull/385)

**Frameworks.** `astro`, `sveltekit`, `react-router`, `cloudflare-workers`

**Wrong:**

```ts
// astro.config.mjs: adapter: cloudflare()  (package.json: @astrojs/cloudflare, wrangler)
// src/lib/posthog.ts: shared batching client reading process.env
// no waitUntil: treated as a plain Node SSR Astro app
```

**Fixed:**

```ts
const CLOUDFLARE_PACKAGES = ['@react-router/cloudflare', '@astrojs/cloudflare',
  '@sveltejs/adapter-cloudflare', '@sveltejs/adapter-cloudflare-workers',
  '@cloudflare/workers-types', 'wrangler']
// detectCloudflareTarget(installDir): true if wrangler.@(toml|jsonc|json)
// exists in the root or any package above is in dependencies/devDependencies
// fetchCloudflareReference(skillsBaseUrl) -> GET <skillsBaseUrl>/cloudflare-workers.md
```

## iOS extensions get their own anonymous identity

**Problem.** Default setup works in the main app, and nothing tells the agent that widgets, app clips and share extensions need a shared app group to reuse the same id.

**Impact.** Silent: one user shows up as several persons across the app and its extensions.

**Rule location.** [`context-mill: context/commandments.yaml#ios`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#151](https://github.com/PostHog/context-mill/pull/151)

**Frameworks.** `ios`, `swift`

**Wrong:**

```swift
// Widget extension
let config = PostHogConfig(apiKey: token, host: host)
PostHogSDK.shared.setup(config) // own anonymous ID
```

**Fixed:**

```swift
let config = PostHogConfig(apiKey: token, host: host)
// main app and every extension
config.appGroupIdentifier = "group.com.example.app"
PostHogSDK.shared.setup(config)
```

## inject() rule refactors existing Angular classes

**Problem.** The commandment 'use inject() instead of constructor injection' reads as a codebase-wide rule, so the agent converts existing constructors it only needed to add a call to.

**Impact.** Unrelated diff noise and merge risk in files the integration should barely touch.

**Rule location.** [`context-mill: context/commandments.yaml#angular`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 311, 'Use inject() instead of constructor injection') interacting with wizard: src/lib/agent/commandments.ts line 24 ('Prefer minimal, targeted edits ... Avoid large refactors')

**Sources.** [PostHog/wizard-workbench#3174](https://github.com/PostHog/wizard-workbench/pull/3174)

**Frameworks.** `angular`

**Wrong:**

```diff
- constructor(private readonly _credentialsService: CredentialsService) {}
+ private readonly _credentialsService = inject(CredentialsService);
+ private readonly posthogService = inject(PostHogService);
```

**Fixed:**

```typescript
// new PostHog code uses inject(); existing constructor injection stays
// (kept by the minimal-edits rule, not by the angular rule itself)
constructor(private readonly _credentialsService: CredentialsService) {}
private readonly posthogService = inject(PostHogService);
```

## Astro view transitions drop pageviews and listeners

**Problem.** Default init and DOMContentLoaded work on a normal site. With view transitions, soft navigation never reloads the page, and nothing errors.

**Impact.** Silent. Navigations after the first load produce no pageviews and page scripts stop reacting.

**Rule location.** [`context-mill: context/commandments.yaml#astro-view-transitions`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#73](https://github.com/PostHog/context-mill/pull/73), [PostHog/wizard-workbench#4379](https://github.com/PostHog/wizard-workbench/pull/4379)

**Frameworks.** `astro`

**Wrong:**

```js
posthog.init(key, { api_host: host })   // default pageview capture
document.addEventListener('DOMContentLoaded', setupPage)
```

**Fixed:**

```js
posthog.init(key, { api_host: host, capture_pageview: 'history_change' })
document.addEventListener('DOMContentLoaded', setupPage)
document.addEventListener('astro:page-load', setupPage)
```

## TanStack Router pageviews tracked with useEffect

**Problem.** The generic React pattern is a useEffect on location. The agent does not know TanStack Router has navigation events built for this.

**Impact.** Duplicate or missed pageviews, because effects fire on re-renders and mounts, not navigations.

**Rule location.**

- [`context-mill: context/commandments.yaml#tanstack-router`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 170)
- [`context-mill: example-apps/react-tanstack-router-file-based/src/routes/__root.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-tanstack-router-file-based/src/routes/__root.tsx)

**Sources.** [PostHog/context-mill#67](https://github.com/PostHog/context-mill/pull/67)

**Frameworks.** `tanstack-router`

**Wrong:**

```tsx
const location = useLocation()
useEffect(() => {
  posthog.capture('$pageview')
}, [location.pathname])
```

**Fixed:**

```ts
// Rule: use TanStack Router's built-in navigation events for pageviews,
// never a useEffect. Example app init (defaults date enables history_change):
posthog.init(key, { api_host: host, defaults: '2026-01-30' })
```

## Flutter screens untracked or unnamed

**Problem.** Told 'track actions, not pageviews, autocapture covers those', the agent skips PosthogObserver, and unnamed routes or a non-default router give it an excuse. When it does add the observer, unnamed routes leave it nothing to report, and nothing warns.

**Impact.** Silent: no $screen events and no navigation data at all, or $screen events with no useful names.

**Rule location.**

- [`context-mill: context/commandments.yaml#flutter`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: context/skills/integration-v2/capture/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/capture/description.md) (Choose and record)

**Sources.** [PostHog/context-mill#346](https://github.com/PostHog/context-mill/pull/346), [PostHog/context-mill#150](https://github.com/PostHog/context-mill/pull/150), [context-mill@e47207b](https://github.com/PostHog/context-mill/commit/e47207bf), [context-mill@da3f59f](https://github.com/PostHog/context-mill/commit/da3f59f7), [wizard-workbench@54ecc1a](https://github.com/PostHog/wizard-workbench/commit/54ecc1ad6)

**Frameworks.** `flutter`

**Wrong:**

```dart
MaterialApp(
  // unnamed routes, so no observer added
  home: const HomeScreen(),
)
Navigator.push(context,
  MaterialPageRoute(builder: (_) => const ProfilePage()));   // no name
```

**Fixed:**

```dart
MaterialApp(
  navigatorObservers: [PosthogObserver()], // whatever the routing package
  routes: {'/home': (_) => const HomeScreen()}, // name routes so $screen is readable
)
Navigator.push(context, MaterialPageRoute(
  settings: const RouteSettings(name: 'profile'),
  builder: (_) => const ProfilePage()));
```

## Hand-rolled app lifecycle events in Flutter

**Problem.** Older SDK versions needed manual lifecycle tracking, and the agent copies that pattern. Since 5.23.0 the SDK captures these events by default.

**Impact.** Duplicate lifecycle events inflate open and install counts.

**Rule location.**

- [`context-mill: example-apps/flutter/lib/posthog/posthog.dart`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/lib/posthog/posthog.dart) (lines 57-59)
- [`context-mill: example-apps/flutter/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/README.md) ('Application lifecycle events')

**Sources.** [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266)

**Frameworks.** `flutter`

**Wrong:**

```dart
WidgetsBinding.instance.addObserver(MyObserver());
// MyObserver captures 'Application Opened' by hand
```

**Fixed:**

```dart
// Application Installed / Updated / Opened / Backgrounded are captured by default
// (captureApplicationLifecycleEvents, on since 5.23.0); add nothing
```

## SwiftUI screens named by internal view identifiers

**Problem.** Turning on captureScreenViews works for UIKit and produces $screen events, so the agent assumes SwiftUI is covered. The names it produces are internal view identifiers and nothing flags it.

**Impact.** Silent: $screen events carry internal SwiftUI view names or are missing, so screen analytics are unreadable.

**Rule location.**

- [`context-mill: context/commandments.yaml#ios`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('For SwiftUI apps, prefer meaningful .postHogScreenView(...) modifiers')
- `context-mill: example-apps/swift-xcodegen/BurritoStand/ContentView.swift:22`

**Sources.** [PostHog/context-mill#151](https://github.com/PostHog/context-mill/pull/151)

**Frameworks.** `ios`, `swift`, `swiftui`

**Wrong:**

```swift
config.captureScreenViews = true   // SwiftUI names come out as internal view identifiers
PostHogSDK.shared.setup(config)
// or:
.onAppear { PostHogSDK.shared.capture("dashboard_viewed") }
```

**Fixed:**

```swift
VStack { /* ... */ }
    .padding()
    .postHogScreenView("BurritoStand")   // meaningful name
```

## Flutter platform minimums left below the SDK floor

**Problem.** Adding posthog\_flutter to pubspec looks complete. The native iOS, macOS and Android minimums live in separate files the agent does not check.

**Impact.** Native builds fail to resolve pods or Gradle dependencies. The SDK needs iOS 13.0, macOS 10.15 and minSdk 23.

**Rule location.**

- [`context-mill: context/commandments.yaml#flutter`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (Android minSdkVersion 23, iOS platform :ios '13.0')
- [`context-mill: example-apps/flutter/ios/Podfile`](https://github.com/PostHog/context-mill/tree/main/example-apps/flutter/ios/Podfile) macos/Podfile, android/app/build.gradle.kts

**Sources.** [PostHog/context-mill#150](https://github.com/PostHog/context-mill/pull/150), [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266)

**Frameworks.** `flutter`

**Wrong:**

```ruby
# ios/Podfile
platform :ios, '12.0'   # below the SDK floor
# android/app/build.gradle.kts: minSdk = 21
```

**Fixed:**

```ruby
# ios/Podfile: posthog_flutter requires iOS 13.0+ (raise only when lower or missing)
platform :ios, '13.0'
# macos/Podfile (example app only, not in the commandment)
platform :osx, '10.15'
# android: minSdk >= 23 (example: minSdk = flutter.minSdkVersion, default 24)
```

## Token hardcoded in Angular environment file

**Problem.** Angular convention and the commandment wording ('configure credentials in environment.ts') invite a literal in a committed file.

**Impact.** The token is committed and bypasses the .env flow, so each environment needs a code edit.

**Rule location.**

- [`context-mill: context/commandments.yaml#angular`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 'Configure PostHog credentials in src/environments/environment.ts files')
- [`context-mill: example-apps/angular/src/environments/environment.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/angular/src/environments/environment.ts)

**Sources.** [PostHog/wizard-workbench#1838](https://github.com/PostHog/wizard-workbench/pull/1838), [PostHog/wizard-workbench#807](https://github.com/PostHog/wizard-workbench/pull/807)

**Frameworks.** `angular`

**Wrong:**

```typescript
// src/environments/.env.ts (committed)
export const env = {
  posthog_token: 'phc_REAL_TOKEN_HERE',
  posthog_host: 'https://us.i.posthog.com',
};
```

**Fixed:**

```typescript
export const environment = {
  production: false,
  posthogKey: import.meta.env['NG_APP_POSTHOG_PROJECT_TOKEN'] || '<ph_project_token>',
  posthogHost: import.meta.env['NG_APP_POSTHOG_HOST'] || 'https://us.posthog.com',
};
```

## Laravel config:cache ignores the server .env

**Problem.** Writing to .env is the normal Laravel habit. After `config:cache`, .env is not loaded at runtime, and the SDK reads getenv(), not config().

**Impact.** Silent: the release ID never arrives at runtime.

**Rule location.** context-mill (main): context/skills/error-tracking-link-releases/description.md, section 'Give the release ID to the running app', Tips bullet starting 'Laravel with `php artisan config:cache`'

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `laravel`, `php`

**Wrong:**

```bash
# deploy step
echo "POSTHOG_RELEASE_ID=$ID" >> /srv/app/.env
php artisan config:cache     # .env is no longer read at runtime
```

**Fixed:**

```dockerfile
# must be a real process env var: container ENV, FPM pool env[...], or service env
ARG POSTHOG_RELEASE_ID
ENV POSTHOG_RELEASE_ID=$POSTHOG_RELEASE_ID
# plus env[POSTHOG_RELEASE_ID] = $POSTHOG_RELEASE_ID in the FPM pool
```
