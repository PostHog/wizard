# Content Security Policy blocks the SDK

9 cases. Part of the [edge case catalogue](../edge-cases.md).

## Review trusts 'CSP handled' without checking directives

**Problem.** The init step says 'CSP handled' and review takes the handoff at its word instead of opening the policy. A connect-src-only fix looks complete because events still send.

**Impact.** A partial CSP passes review, so replay, surveys and the toolbar silently never load (events still send, so the integration looks alive).

**Rule location.**

- [`context-mill: context/agents/integration-v2/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/init.md) (lines ~31-36, handoff names touched CSP directives)
- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) (lines ~52-61, 'The CSP lets it run')

**Sources.** [PostHog/context-mill#278](https://github.com/PostHog/context-mill/pull/278), [context-mill@2eb359b](https://github.com/PostHog/context-mill/commit/2eb359ba)

**Frameworks.** `javascript_web`, `nextjs`, `react`

**Wrong:**

```text
init handoff: "Content-Security-Policy handled."
review: reads handoff, marks CSP dimension done
        (never opens the policy to check script-src / connect-src / worker-src)
```

**Fixed:**

```text
# init handoff names directives touched and left alone:
#   touched script-src, connect-src, worker-src; left X alone
# (an unnamed directive reads as unhandled, not as fine)
# review verifies directive-by-directive, not on the handoff's word:
script-src  allows PostHog hosts (needed even when posthog-js is bundled;
            replay/surveys/toolbar lazy-load from the assets CDN)
connect-src allows the API host (bare default-src 'self' blocks sending)
worker-src  blob: if session replay is on
```

## Site CSP blocks the SDK, zero events

**Problem.** The agent adds the snippet or import and never looks for a Content-Security-Policy, because the build passes and nothing errors. The browser blocks the script at runtime and the stub queues calls into an array nothing drains.

**Impact.** Silent: the diff looks complete and zero events ever arrive.

**Rule location.**

- [`context-mill: context/skills/integration-v2/init/description.md#Content`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) Security Policy
- integration-v2/build/description.md (The CSP lets it run)
- [`context-mill: context/agents/integration-v2/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/init.md) (handoff names directives)
- GAP in integration v1

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245#issuecomment-5024035756), [PostHog/context-mill#278](https://github.com/PostHog/context-mill/pull/278), [context-mill@eb44fa3](https://github.com/PostHog/context-mill/commit/eb44fa39)

**Frameworks.** `php`, `javascript_web`, `astro`, `nextjs`, `all browser SDK apps`

**Wrong:**

```html
<meta http-equiv="Content-Security-Policy" content="script-src 'self'; connect-src 'self'">
<script>
  !function(t,e){/* loads us-assets.i.posthog.com/static/array.js */}(document,window.posthog||[]);
  posthog.init(apiKey, { api_host: 'https://us.i.posthog.com' })
</script>
```

**Fixed:**

```text
# extend the existing policy, every directive in one pass
script-src:  https://*.posthog.com   (lazy-loaded bundles, even when self-hosting the entry)
connect-src: <the api host>          (event ingestion + feature flags)
worker-src:  blob:                   (session replay's worker)
# or bundle posthog-js and send events through a same-origin proxy
```

## CSP built in server code goes unnoticed

**Problem.** The agent greps templates for a CSP meta tag, finds none, and assumes there is no policy. Many apps build the header in middleware or a controller, so the agent never sees it.

**Impact.** Silent: the SDK script and event requests are blocked by a header the agent never opened.

**Rule location.** [`context-mill: context/skills/integration-v2/init/description.md#Content`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) Security Policy ('a meta tag in the HTML or a header the server sends')

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/wizard-workbench#3112](https://github.com/PostHog/wizard-workbench/pull/3112)

**Frameworks.** `php`, `javascript-node`, `react-router`, `all browser SDK apps`

**Wrong:**

```shell
grep -ri 'Content-Security-Policy' public/ templates/   # no meta tag, CSP assumed absent
# policy actually built in lib/Minz/ActionController.php, lib/defaults.js, csp.ts
```

**Fixed:**

```php
// ActionController::declareCspHeader(): extend the policy where the app builds it
$sources = [
  'connect-src' => $posthogHost,
  'script-src'  => str_replace('.i.posthog.com', '-assets.i.posthog.com', $posthogHost),
];
foreach ($sources as $directive => $src) { $this->csp_policies[$directive] .= ' ' . $src; }
```

## CSP allows events but not lazy-loaded scripts

**Problem.** Bundling posthog-js looks like it satisfies script-src, and the skill itself once said so. Replay, surveys, error tracking and the toolbar lazy-load from the \*.posthog.com assets CDN, and allowing only the API host misses those origins.

**Impact.** Silent: events send so the integration looks alive, while replay, surveys and the toolbar never load.

**Rule location.**

- [`context-mill: context/skills/integration-v2/init/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) (Content Security Policy, 'Work within it' bullet)
- integration-v2/build/description.md (CSP bullet)

**Sources.** [PostHog/context-mill#278](https://github.com/PostHog/context-mill/pull/278), [context-mill@2eb359b](https://github.com/PostHog/context-mill/commit/2eb359ba), [PostHog/wizard-workbench#3112](https://github.com/PostHog/wizard-workbench/pull/3112), [PostHog/wizard-workbench#4446](https://github.com/PostHog/wizard-workbench/pull/4446)

**Frameworks.** `react-router`, `nextjs`, `javascript_web`, `all browser SDK apps`

**Wrong:**

```typescript
// entry.server.tsx
"connect-src": ["'self'", process.env.VITE_PUBLIC_POSTHOG_HOST],
"script-src": ["'strict-dynamic'", "'self'", `'nonce-${nonce}'`],  // PostHog CDN not allowed
```

**Fixed:**

```text
script-src:  https://*.posthog.com   (lazy-loaded bundles, even when bundled)
connect-src: <the api host>          (event ingestion + feature flags)
worker-src:  blob:                   (session replay's worker)
# extend every directive in one pass; partial edits fail silently
```

## CSP blocks session replay while events send

**Problem.** Replay needs more than events: recorder.js under script-src (and script-src-elem if set) plus a blob: worker under worker-src. An agent extends one or two directives, sees events arrive, and stops.

**Impact.** Silent: events send, but replay never starts or never uploads. The CSP violations sit in a console nobody opens.

**Rule location.**

- [`context-mill: context/skills/integration-v2/init/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) ('extend every directive the SDK needs in one pass')
- posthog-best-practices/references/session-replay.md ('Check CSP early', error rule)

**Sources.** [PostHog/context-mill#278](https://github.com/PostHog/context-mill/pull/278), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108)

**Frameworks.** `posthog-js`, `all browser SDK apps`

**Wrong:**

```text
connect-src 'self' blob: ${domain} https://*.posthog.com
worker-src 'self'
```

**Fixed:**

```text
connect-src 'self' blob: ${domain} https://*.posthog.com
worker-src 'self' blob: data:
# if the app sets script-src-elem, it needs the PostHog assets host too
```

## default-src self silently blocks event sending

**Problem.** The agent allows the PostHog hosts in script-src and assumes it is done. Without its own connect-src, the policy falls back to default-src 'self'.

**Impact.** Silent: the SDK loads but every event request is blocked.

**Rule location.**

- [`context-mill: context/skills/integration-v2/init/description.md#Content`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) Security Policy
- integration-v2/build/description.md (CSP lets it run)

**Sources.** [context-mill@eb44fa3](https://github.com/PostHog/context-mill/commit/eb44fa39), [PostHog/posthog.com#18611](https://github.com/PostHog/posthog.com/pull/18611)

**Frameworks.** `all browser SDK apps`

**Wrong:**

```text
Content-Security-Policy: default-src 'self'; script-src 'self' https://*.posthog.com
# no connect-src: falls back to default-src 'self', ingestion blocked
```

**Fixed:**

```text
Content-Security-Policy: default-src 'self'; script-src 'self' https://*.posthog.com;
  connect-src 'self' https://us.i.posthog.com; worker-src 'self' blob:
# or route events through a same-origin proxy
```

## Rails CSP initializer left blocking PostHog

**Problem.** The agent gives the layout snippet a CSP nonce and believes the CSP is handled. The host allowlist lives in config/initializers/content\_security\_policy.rb, which it never opens, or it only tells the user to set env vars.

**Impact.** Silent: array.js and the replay and survey bundles are blocked. The diff looks complete while zero events send.

**Rule location.**

- [`context-mill: context/skills/integration-v2/init/description.md#Content`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) Security Policy (generic, no Rails-specific rule)
- [`context-mill: context/skills/posthog-best-practices/references/session-replay.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/session-replay.md) (line 11)

**Sources.** [PostHog/wizard-workbench#2729](https://github.com/PostHog/wizard-workbench/pull/2729), [PostHog/wizard-workbench#1064](https://github.com/PostHog/wizard-workbench/pull/1064), [PostHog/context-mill#278](https://github.com/PostHog/context-mill/pull/278), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `ruby-on-rails`

**Wrong:**

```ruby
# config/initializers/content_security_policy.rb left as shipped
policy.script_src  :self, *sources.(:script_src)
policy.connect_src :self, *sources.(:connect_src)
# layout adds <script nonce=...> PostHog snippet; the CDN bundle is blocked
```

**Fixed:**

```ruby
policy.script_src  :self, "https://us-assets.i.posthog.com", *sources.(:script_src)
policy.connect_src :self, "https://us.i.posthog.com", "https://us-assets.i.posthog.com", *sources.(:connect_src)
policy.worker_src  :self, :blob   # session replay worker (from the generic rule, not in 2729)
```

## Replay assets lack CORS and crossorigin

**Problem.** Turning on replay looks like one config flag. Nothing tells the agent that replay re-loads the app's fonts, stylesheets and images from origin, and that those responses need Access-Control-Allow-Origin for the PostHog app origin. Stylesheet links also need crossorigin to be readable for capture.

**Impact.** Silent: capture looks healthy, but replays render unstyled or without fonts and images.

**Rule location.** [`context-mill: context/skills/posthog-best-practices/references/session-replay.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/session-replay.md) (line 12: error-level CORS rule for replayed assets, line 13: warning-level crossorigin="anonymous" on stylesheet links)

**Sources.** [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108)

**Frameworks.** `javascript_web`, `nextjs`, `sveltekit`, `angular`

**Wrong:**

```html
<link rel="stylesheet" href="https://cdn.example.com/app.css">
<!-- asset responses carry no Access-Control-Allow-Origin -->
```

**Fixed:**

```html
<link rel="stylesheet" href="https://cdn.example.com/app.css" crossorigin="anonymous">
<!-- asset responses: Access-Control-Allow-Origin: https://us.posthog.com -->
```

## Bundled SDK still needs script-src for lazy bundles

**Problem.** Bundling posthog-js looks like it satisfies script-src, and the old skill even said so. But replay, surveys and the toolbar lazy-load from the PostHog assets CDN, not from the API host.

**Impact.** Silent: events send, so the integration looks alive, but session replay, surveys and the toolbar never load.

**Rule location.**

- [`context-mill: context/skills/integration-v2/init/description.md#Content`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/init/description.md) Security Policy ('Work within it' + the directive block)
- [`context-mill: context/skills/integration-v2/build/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/build/description.md) ('The CSP lets it run')
- [`context-mill: context/skills/posthog-best-practices/references/session-replay.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/session-replay.md) (line 11, 'Check CSP early')

**Sources.** [PostHog/context-mill#278](https://github.com/PostHog/context-mill/pull/278), [context-mill@2eb359b](https://github.com/PostHog/context-mill/commit/2eb359ba), [PostHog/wizard-workbench#3112](https://github.com/PostHog/wizard-workbench/pull/3112), [PostHog/wizard-workbench#4446](https://github.com/PostHog/wizard-workbench/pull/4446)

**Frameworks.** `react-router`, `nextjs`, `php`, `javascript_web`, `all browser SDK apps`

**Wrong:**

```typescript
// entry.server.tsx (react-router saas-template)
"connect-src": [MODE === 'development' ? 'ws:' : undefined, "'self'", process.env.VITE_PUBLIC_POSTHOG_HOST],
"script-src": ["'strict-dynamic'", "'self'", `'nonce-${nonce}'`],  // untouched
```

**Fixed:**

```text
Whenever you extend a CSP, extend every directive the SDK needs in one pass:
script-src:  https://*.posthog.com   (lazy-loaded bundles, even when self-hosting the entry)
connect-src: <the api host>          (event ingestion + feature flags)
worker-src:  blob:                   (session replay's worker)
```
