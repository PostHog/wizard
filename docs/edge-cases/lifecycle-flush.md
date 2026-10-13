# Events dropped at process exit

25 cases. Part of the [edge case catalogue](../edge-cases.md).

## Server route returns before batched event sends

**Problem.** posthog-node capture() only enqueues, and on a long-lived local dev server the batch still goes out, so the bug never shows locally. Old docs and the old commandment said not to set flushAt or flushInterval in 'long-running servers', which agents applied to Next.js, Nuxt, SvelteKit, Astro and TanStack Start route handlers.

**Impact.** Silent: on serverless or edge the function freezes on return before the batched HTTP send, so server events are dropped. Low-traffic endpoints lose most events.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 66), #nextjs-feature-flags, #sveltekit, #astro-ssr, #astro-hybrid
- [`context-mill: example-apps/next-app-router/src/app/api/auth/login/route.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/src/app/api/auth/login/route.ts) next-pages-router, nuxt-4/server/api/auth/login.post.ts, sveltekit/src/hooks.server.ts, tanstack-start/src/routes/api/burrito/consider.ts, astro-ssr and astro-hybrid src/pages/api/\*

**Sources.** [PostHog/context-mill#228](https://github.com/PostHog/context-mill/pull/228), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [PostHog/context-mill#62](https://github.com/PostHog/context-mill/pull/62), [context-mill@4b918d3](https://github.com/PostHog/context-mill/commit/4b918d34915e12077ba28dad18b69a922a3a86d6), [context-mill@2bc8a2d](https://github.com/PostHog/context-mill/commit/2bc8a2d817b88f16c2ea1cac304276eb757b3b01), [PostHog/wizard-workbench#1771](https://github.com/PostHog/wizard-workbench/pull/1771)

**Frameworks.** `nextjs`, `nuxt`, `sveltekit`, `astro`, `remix`, `tanstack-start`, `javascript_node`, `serverless`, `lambda`

**Wrong:**

```typescript
// lib/posthog-server.ts
const posthog = new PostHog(token, { host })   // default batching: 20 events / 10s

export async function POST(request: Request) {
  posthog.capture({ distinctId: username, event: 'server_login' })
  return NextResponse.json({ success: true, user }) // returns before the send
}
```

**Fixed:**

```typescript
// lib/posthog-server.ts
new PostHog(token, { host, flushAt: 1, flushInterval: 0 })

// api/auth/login/route.ts
posthog.capture({ distinctId: username, event: 'server_login' })
// This handler is short-lived; flush so the enqueued events send before it returns
await posthog.flush()
return NextResponse.json({ success: true, user })
```

## Server error hook captures but never flushes

**Problem.** An error hook like SvelteKit handleError does not look like a request handler, so the agent does not apply the flush rule there, and it copies the old unflushed example. The request ends right after the hook.

**Impact.** Silent: the one event that describes the failure is the one most likely to be lost.

**Rule location.**

- [`context-mill: context/commandments.yaml#sveltekit`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 238, names hooks like handleError)
- [`context-mill: example-apps/sveltekit/src/hooks.server.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/sveltekit/src/hooks.server.ts) (lines 56-57)

**Sources.** [PostHog/context-mill#228](https://github.com/PostHog/context-mill/pull/228), [context-mill@2bc8a2d](https://github.com/PostHog/context-mill/commit/2bc8a2d8), [PostHog/wizard-workbench#2009](https://github.com/PostHog/wizard-workbench/pull/2009)

**Frameworks.** `sveltekit`

**Wrong:**

```typescript
export const handleError: HandleServerError = async ({ error, status, message }) => {
  posthog.capture({ distinctId: 'server', event: 'server_error',
    properties: { error: String(error), status, message } })  // batched, never sent
  return { message, status }
}
```

**Fixed:**

```typescript
// singleton: new PostHog(token, { host, flushAt: 1, flushInterval: 0 })
export const handleError: HandleServerError = async ({ error, status, message }) => {
  posthog.capture({ distinctId: 'server', event: 'server_error',
    properties: { error: String(error), status, message } })
  // handleError runs per request; flush so the event sends before it returns
  await posthog.flush()
  return { message, status }
}
```

## Shutting down the shared client every request

**Problem.** Once an agent learns 'flush before returning', shutdown() looks like the stronger version, so it copies the script pattern await posthog.shutdown() into a handler that reuses a module-level client. Early examples exported a shutdownPostHog helper next to the singleton, which pointed the same way.

**Impact.** Silent: after the first request the cached client is terminated and its flush timer cleared, so every later request drops its events. Overlapping calls log warnings.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 66: 'Always use await posthog.flush() for a shared/singleton client, await posthog.shutdown() for a per-request client')
- #astro-ssr and #astro-hybrid (flush the singleton)
- [`context-mill: example-apps/tanstack-start/src/utils/posthog-server.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/tanstack-start/src/utils/posthog-server.ts) (helper removed). Note: astro-ssr, astro-hybrid and sveltekit examples still export an unused shutdownPostHog

**Sources.** [PostHog/wizard-workbench#2712](https://github.com/PostHog/wizard-workbench/pull/2712), [PostHog/context-mill#228](https://github.com/PostHog/context-mill/pull/228), [PostHog/context-mill#67](https://github.com/PostHog/context-mill/pull/67), [context-mill@2bc8a2d](https://github.com/PostHog/context-mill/commit/2bc8a2d8)

**Frameworks.** `astro`, `nuxt`, `nextjs`, `sveltekit`, `tanstack-start`, `javascript_node`

**Wrong:**

```typescript
const posthog = getPostHogServer()   // module-level singleton
posthog.capture({ distinctId, event: 'contact_form_received' })
await posthog.shutdown()             // every request, closes the shared client
```

**Fixed:**

```typescript
const posthog = getPostHogClient()   // flushAt: 1, flushInterval: 0
posthog.capture({ distinctId, event: 'server_login' })
await posthog.flush()      // shared client: flush per request, client stays alive
// shutdown() only for a per-request client, or once at process exit
```

## Per-request server client never shut down

**Problem.** Constructing the client next to the capture call looks self-contained and works in a quick test, and the default batch (flushAt 20, 10s) gives no sign nothing was sent. Agents do not know a per-request client needs shutdown() rather than flush().

**Impact.** Silent: the batch never sends before the handler ends, so events like server\_login are lost, and every request leaks a client with its timers and sockets.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 66)
- [`context-mill: example-apps/react-react-router-7-framework/app/lib/posthog-middleware.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-7-framework/app/lib/posthog-middleware.ts) (lines 10-26)
- [`context-mill: example-apps/nuxt-3-6/server/api/auth/login.post.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-3-6/server/api/auth/login.post.ts) (per-request client, shutdown at line 51)

**Sources.** [PostHog/context-mill#228](https://github.com/PostHog/context-mill/pull/228), [context-mill@e512ef8](https://github.com/PostHog/context-mill/commit/e512ef8d), [context-mill@30cf713](https://github.com/PostHog/context-mill/commit/30cf713e)

**Frameworks.** `react-router-7-framework`, `nuxt`, `nextjs`, `sveltekit`, `astro`, `tanstack-start`, `javascript_node`

**Wrong:**

```typescript
export async function action({ request }: Route.ActionArgs) {
  const posthog = new PostHog(process.env.POSTHOG_KEY!, { host })
  posthog.capture({ distinctId: username, event: 'server_login' })
  return Response.json({ success: true })   // never shut down
}
```

**Fixed:**

```typescript
export const posthogMiddleware: Route.MiddlewareFunction = async ({ request, context }, next) => {
  const posthog = new PostHog(token, { host, flushAt: 1, flushInterval: 0 })
  ;(context as PostHogContext).posthog = posthog
  const response = await posthog.withContext({ sessionId, distinctId }, next)
  await posthog.shutdown().catch(() => {}) // per-request client: shutdown, not flush
  return response
}
// or: one module singleton (flushAt: 1, flushInterval: 0) + await posthog.flush()
```

## Node server has no shutdown on SIGTERM

**Problem.** Agents treat shutdown as something only scripts need, and the rule to flush before exit reads as not applicable to an Express or Koa app with no existing exit path. Nothing breaks while the server runs.

**Impact.** Silent: events and OTel log records still queued at every stop, deploy or restart are lost.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 65, still conditional, unconditional wording proposed in #1330, Rust analog at line 97 from #354)
- [`context-mill: example-apps/javascript-node/todo.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/javascript-node/todo.js) (lines 222-233)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (line 130, shutdown only for short-lived processes)
- `wizard: src/frameworks/javascript-node/javascript-node-wizard-agent.ts` (line 63)

**Sources.** [PostHog/wizard#1330](https://github.com/PostHog/wizard/issues/1330), [PostHog/wizard#283](https://github.com/PostHog/wizard/pull/283), [PostHog/context-mill#89](https://github.com/PostHog/context-mill/pull/89), [PostHog/context-mill#354](https://github.com/PostHog/context-mill/pull/354), [PostHog/wizard-workbench#4434](https://github.com/PostHog/wizard-workbench/pull/4434), [PostHog/wizard-workbench#4289](https://github.com/PostHog/wizard-workbench/pull/4289)

**Frameworks.** `javascript_node`, `express`, `koa`, `fastify`, `hono`

**Wrong:**

```javascript
const posthog = new PostHog(token, { host })
app.post('/todos', (req, res) => {
  posthog.capture({ distinctId: id, event: 'todo_added' })
  res.status(201).json(todo)
})
app.listen(PORT) // no SIGINT/SIGTERM handler, nothing calls posthog.shutdown()
```

**Fixed:**

```javascript
const server = app.listen(PORT)
async function shutdown() {
  server.close()
  await posthog.shutdown() // drains the batch
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
```

## Node script exits before the batch sends

**Problem.** process.exit() at the end of a CLI or job looks like a clean finish. posthog-node sends asynchronously, and flush() vs shutdown() is not obvious from the API.

**Impact.** Silent: pending events are dropped at exit.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (Node.js: 'call await posthog.shutdown() before exit', 'flush() only for per-request cleanup')
- [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 65: 'await flush() or await shutdown() before letting that process exit')

**Sources.** [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#228](https://github.com/PostHog/context-mill/pull/228)

**Frameworks.** `javascript_node`

**Wrong:**

```javascript
const posthog = new PostHog(key, { host })
posthog.capture({ distinctId: 'cli', event: 'job_done' })
process.exit(0) // batched HTTP send never ran
```

**Fixed:**

```javascript
const posthog = new PostHog(key, { host })
posthog.capture({ distinctId: 'cli', event: 'job_done' })
await posthog.shutdown()   // short-lived process: flush and close
process.exit(0)
// long-lived shared client: await posthog.flush() instead
```

## Python script exits without calling shutdown

**Problem.** capture() returns at once and the SDK sends from a background thread, so a script's last capture() line looks like a natural end. Python only does a short best-effort flush at exit and nothing errors.

**Impact.** Silent: events still in the in-memory queue are often lost when the process exits, especially for a short CLI run.

**Rule location.**

- [`context-mill: context/commandments.yaml#python`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 73 'In CLIs and scripts: MUST call posthog.shutdown() before exit or all events are lost', line 78 atexit.register rule)
- [`context-mill: example-apps/python/todo.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/python/todo.py) (try/finally shutdown, ~line 272)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (Python)

**Sources.** [PostHog/context-mill#70](https://github.com/PostHog/context-mill/pull/70), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193), [`posthog-python: posthog/client.py`](https://github.com/PostHog/posthog-python/blob/master/posthog/client.py)

**Frameworks.** `python`, `django`, `flask`

**Wrong:**

```python
posthog_client = Posthog(token, host=host)

def main():
    posthog_client.capture('job_finished', distinct_id=user_id)
    sys.exit(0)  # queue never flushed
```

**Fixed:**

```python
posthog_client = Posthog(token, host=host, enable_exception_autocapture=True)
atexit.register(posthog_client.shutdown)  # commandment, not in todo.py
try:
    run_command(args, posthog_client)
finally:
    # IMPORTANT: Always shutdown PostHog to flush events
    posthog_client.shutdown()
```

## FastAPI app has no shutdown flush

**Problem.** Training data uses import-time setup or the deprecated @app.on\_event('startup') hook, which has no natural place to flush. Nothing fails while uvicorn runs.

**Impact.** Silent: events still queued when uvicorn stops or reloads are lost, and config errors show up at import time instead of startup.

**Rule location.**

- [`context-mill: context/commandments.yaml#fastapi`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (lines 155-156: init in lifespan, posthog.flush() in lifespan shutdown)
- [`context-mill: example-apps/fastapi/app/main.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/fastapi/app/main.py) (lifespan, ~lines 26-53)
- [`context-mill: context/skills/posthog-best-practices/description.md#FastAPI`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (says posthog.shutdown() in lifespan shutdown)

**Sources.** [PostHog/context-mill#63](https://github.com/PostHog/context-mill/pull/63), [PostHog/wizard#251](https://github.com/PostHog/wizard/pull/251)

**Frameworks.** `fastapi`, `python`

**Wrong:**

```python
import posthog
posthog.api_key = settings.posthog_project_token   # runs at import
posthog.host = settings.posthog_host
app = FastAPI()   # no lifespan, nothing flushes on shutdown
```

**Fixed:**

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.posthog_disabled:
        posthog.api_key = settings.posthog_project_token
        posthog.host = settings.posthog_host
    yield
    if not settings.posthog_disabled:
        posthog.flush()   # send queued events before exit
```

## Laravel queue job events never sent

**Problem.** posthog-php sends when batch\_size (100) is reached, when the client destructs, or, in newer versions, opportunistically after flush\_interval\_seconds when another event is enqueued. A queue:work, Horizon or Octane worker never destructs, so events sit in memory. Web-request events still arrive, so the integration looks fine, and the agent followed every commandment but skipped the flush guidance in the bundled reference.

**Impact.** Silent: job events sit in memory for hours and are lost on worker restart.

**Rule location.** [`context-mill: context/commandments.yaml#laravel`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 182: 'Call PostHog::flush() after capture in queue jobs, Horizon, and Octane')

**Sources.** [PostHog/context-mill#282](https://github.com/PostHog/context-mill/pull/282), [context-mill@6378aeb](https://github.com/PostHog/context-mill/commit/6378aeb2), [`posthog-php: lib/QueueConsumer.php`](https://github.com/PostHog/posthog-php/blob/HEAD/lib/QueueConsumer.php)

**Frameworks.** `laravel`, `php`

**Wrong:**

```php
class TriageFeedback implements ShouldQueue {
    public function handle(): void {
        PostHog::capture([
            'distinctId' => (string) $this->user->id,
            'event' => 'feedback_triage_completed',
        ]); // buffered, never sent
    }
}
```

**Fixed:**

```php
public function handle(): void {
    PostHog::capture([
        'distinctId' => (string) $this->user->id,
        'event' => 'feedback_triage_completed',
    ]);
    PostHog::flush(); // long-running worker never destructs
}
```

## PHP script or WordPress hook never flushes

**Problem.** The agent assumes each PHP capture sends right away, or that the destructor will run at script end. A WordPress action hook has no single exit point to hook a flush onto, and a killed process never runs the destructor.

**Impact.** Silent: buffered events are lost in CLIs, cron jobs and WordPress hooks.

**Rule location.**

- [`context-mill: context/commandments.yaml#wordpress`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 190 'Call PostHog::flush() at the end of a capture - a web request has no single exit point like a CLI script does')
- [`context-mill: example-apps/wordpress/posthog-example/posthog-example.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/wordpress/posthog-example/posthog-example.php) (posthog\_example\_track\_comment, ~lines 86-110)
- [`context-mill: example-apps/php/todo.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/php/todo.php) (finally flush, ~line 345)
- [`context-mill: example-apps/php/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/php/README.md)

**Sources.** [PostHog/context-mill#279](https://github.com/PostHog/context-mill/pull/279), [PostHog/context-mill#136](https://github.com/PostHog/context-mill/pull/136), [PostHog/context-mill#282](https://github.com/PostHog/context-mill/pull/282)

**Frameworks.** `php`, `wordpress`

**Wrong:**

```php
add_action('comment_post', function ($id, $approved, $data) {
    PostHog::capture([
        'distinctId' => (string) $data['user_id'],
        'event' => 'comment_posted',
    ]);
}, 10, 3);

// CLI
PostHog::capture(['distinctId' => $id, 'event' => 'todo_added']);
exit(0);
```

**Fixed:**

```php
PostHog::capture([
    'distinctId' => (string) $distinct_id,
    'event' => 'comment_posted',
    'properties' => ['comment_id' => $comment_id],
]);
PostHog::flush(); // no single exit point in a web request

// CLI: } finally { if ($posthogEnabled) { PostHog::flush(); } }
```

## Lambda and job worker captures never flushed

**Problem.** Captures in Lambdas and Celery, Sidekiq or BullMQ jobs look identical to web-server captures. Losses only hit the last events before a worker or invocation ends, so they are partial and hard to notice.

**Impact.** Silent: events captured just before the process or invocation ends are lost. One customer lost a measurable share of subscription events in Celery workers.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 66: per-request handlers, serverless, edge and Lambda are torn down before the send runs, flushAt 1, flushInterval 0, await flush()/shutdown())
- [`context-mill: context/skills/audit-identify/references/5-server-sdk.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/5-server-sdk.md) (server-sdk-flush-on-exit, Task B)

**Sources.** [PostHog/context-mill#228](https://github.com/PostHog/context-mill/pull/228), [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `aws-lambda`, `vercel`, `celery`, `sidekiq`, `bullmq`, `javascript_node`, `python`, `ruby`

**Wrong:**

```typescript
export async function handler(event) {
  posthog.capture({ distinctId: id, event: 'order_paid' })
  return { statusCode: 200 }
}
```

**Fixed:**

```typescript
const posthog = new PostHog(key, { host, flushAt: 1, flushInterval: 0 })
export async function handler(event) {
  posthog.capture({ distinctId: id, event: 'order_paid' })
  await posthog.flush()   // shared client; shutdown() only for a per-request client
  return { statusCode: 200 }
}
```

## Rust app with no shutdown hook skips flush

**Problem.** The commandment said to flush 'during graceful shutdown', and an app with no shutdown seam read that as not applicable. posthog-rs capture is fire-and-forget, so nothing fails.

**Impact.** Silent: captures still queued when main returns are never delivered.

**Rule location.**

- [`context-mill: context/commandments.yaml#rust`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 97, 'An app with no shutdown path still needs this')
- [`context-mill: example-apps/rust/src/main.rs`](https://github.com/PostHog/context-mill/blob/main/example-apps/rust/src/main.rs) (end of main)
- `wizard: src/frameworks/rust/rust-wizard-agent.ts` (getAdditionalContextLines, line 75, outro line 103)

**Sources.** [PostHog/context-mill#354](https://github.com/PostHog/context-mill/pull/354), [PostHog/context-mill#353](https://github.com/PostHog/context-mill/pull/353), [PostHog/context-mill#269](https://github.com/PostHog/context-mill/pull/269), [PostHog/wizard#947](https://github.com/PostHog/wizard/pull/947)

**Frameworks.** `rust`

**Wrong:**

```rust
let client = posthog_rs::client(options).await;
client.capture(Event::new("file_served", &id)).await?;
// no graceful-shutdown hook, so no flush/shutdown added
axum::serve(listener, app).await?;
```

**Fixed:**

```rust
axum::serve(listener, app)
    .with_graceful_shutdown(shutdown_signal())
    .await
    .expect("server error");
// capture is fire-and-forget: flush, then stop the worker
client.flush().await;
client.shutdown().await;
```

## Go client never closed on shutdown

**Problem.** The common Go server shape is http.ListenAndServe in main with no graceful shutdown, so there is no place where Close() would run.

**Impact.** Silent: events still queued at SIGTERM or exit are dropped.

**Rule location.**

- [`context-mill: context/commandments.yaml#go`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 84, 'Always close the client during graceful shutdown')
- [`context-mill: example-apps/go/main.go`](https://github.com/PostHog/context-mill/blob/main/example-apps/go/main.go) (comment 'Close() blocks until the queue drains')
- `wizard: src/frameworks/go/go-wizard-agent.ts` (getAdditionalContextLines, outro line 98)

**Sources.** [PostHog/context-mill#153](https://github.com/PostHog/context-mill/pull/153), [PostHog/context-mill#267](https://github.com/PostHog/context-mill/pull/267), [PostHog/wizard#945](https://github.com/PostHog/wizard/pull/945)

**Frameworks.** `go`

**Wrong:**

```go
func main() {
	client, _ := posthog.NewWithConfig(token, posthog.Config{Endpoint: host})
	a := &app{posthog: client}
	log.Fatal(http.ListenAndServe(":8000", a.routes())) // queue never drained
}
```

**Fixed:**

```go
srv := &http.Server{Addr: ":8000", Handler: a.routes()}
go srv.ListenAndServe()
<-stop // SIGINT/SIGTERM
srv.Shutdown(ctx)
client.Close() // blocks until the queue drains
```

## Java client never closed when the JVM stops

**Problem.** A static field or a per-request PostHog.with() in a controller is the quickest way to get a client. Nothing ties it to the Spring lifecycle, so close() never runs unless a destroy method is declared.

**Impact.** Silent: the batch queue is not flushed when the Spring context or JVM stops, or clients multiply per request.

**Rule location.**

- [`context-mill: context/commandments.yaml#java-server`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (lines 114, 116)
- [`context-mill: example-apps/java-spring-boot/src/main/java/com/posthog/example/config/PostHogConfiguration.java`](https://github.com/PostHog/context-mill/blob/main/example-apps/java-spring-boot/src/main/java/com/posthog/example/config/PostHogConfiguration.java)
- `wizard: src/frameworks/java/java-wizard-agent.ts` line 126 (getAdditionalContextLines), outro line 150

**Sources.** [PostHog/context-mill#270](https://github.com/PostHog/context-mill/pull/270), [PostHog/wizard#948](https://github.com/PostHog/wizard/pull/948)

**Frameworks.** `java`, `spring-boot`

**Wrong:**

```java
@GetMapping("/x")
String x() {
    PostHogInterface posthog = PostHog.with(
        PostHogConfig.builder(token).host(host).build()); // per request, never closed
    posthog.capture(userId, "x_viewed");
    return "x";
}
```

**Fixed:**

```java
@Bean(destroyMethod = "close")
public PostHogInterface posthog(
        @Value("${posthog.project-token:}") String projectToken,
        @Value("${posthog.host:https://us.i.posthog.com}") String host) {
    return PostHog.with(PostHogConfig.builder(projectToken).host(host).build());
}
// serverless handlers: posthog.flush() before returning
```

## .NET CLI exits without FlushAsync

**Problem.** Capture returns synchronously, so a console app or worker looks done. The queue is drained only by an explicit FlushAsync.

**Impact.** Silent: queued events are never sent from short-lived .NET processes.

**Rule location.**

- [`context-mill: context/commandments.yaml#dotnet`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line 107, 'For CLIs, scripts, workers, and other short-lived processes ... call FlushAsync() before exit')
- no .NET example app or wizard framework agent exists

**Sources.** [PostHog/context-mill#145](https://github.com/PostHog/context-mill/pull/145)

**Frameworks.** `dotnet`

**Wrong:**

```csharp
var posthog = new PostHogClient(options);
posthog.Capture(userId, "report_generated");
return 0; // exits with events still queued
```

**Fixed:**

```csharp
var posthog = new PostHogClient(options); // one client per process
posthog.Capture(userId, "report_generated");
await posthog.FlushAsync();               // before exit
return 0;
```

## Ruby script skips shutdown on some exit paths

**Problem.** The Ruby client sends from a background thread that dies with the script, and nothing errors. Agents leave shutdown out or put it only on the happy path, so an early `exit 1` or a raised error skips it.

**Impact.** Silent: buffered events from a short-lived Ruby process are lost and nothing raises.

**Rule location.**

- [`context-mill: context/commandments.yaml#ruby`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('In CLIs and scripts: MUST call client.shutdown before exit', 'Use begin/rescue/ensure with shutdown in the ensure block')
- [`context-mill: example-apps/ruby/todo.rb`](https://github.com/PostHog/context-mill/blob/main/example-apps/ruby/todo.rb) (ensure block, posthog&.shutdown)
- [`wizard: src/programs/frameworks/ruby/ruby-wizard-agent.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/frameworks/ruby/ruby-wizard-agent.ts) ('### 3. MUST Call shutdown Before Exit')

**Sources.** [PostHog/context-mill#85](https://github.com/PostHog/context-mill/pull/85), [context-mill@5c513bf](https://github.com/PostHog/context-mill/commit/5c513bfd), [PostHog/wizard#276](https://github.com/PostHog/wizard/pull/276), [wizard@26ac00d](https://github.com/PostHog/wizard/commit/26ac00d3)

**Frameworks.** `ruby`, `rails`

**Wrong:**

```ruby
posthog = PostHog::Client.new(api_key: ENV['POSTHOG_PROJECT_TOKEN'])
posthog.capture(distinct_id: id, event: 'todo_added')
exit 1 unless ok   # no shutdown on this path
# script ends; queue never flushed
```

**Fixed:**

```ruby
begin
  posthog = initialize_posthog
  run_cli(ARGV, posthog)
rescue StandardError => e
  posthog&.capture_exception(e, get_user_id)
  exit 1
ensure
  posthog&.shutdown   # always flush events
end
```

## Metrics lost when a short script exits

**Problem.** Metrics flush on an interval, so a counter call in a cron job, script or serverless function looks complete. The process exits before the first interval fires.

**Impact.** Silent: no metrics arrive at all.

**Rule location.**

- [`context-mill: context/skills/metrics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/metrics/description.md) (Key principles: Flushing)
- [`context-mill: context/skills/omnibus/instrument-metrics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/omnibus/instrument-metrics/description.md) (STEP 7)

**Sources.** [PostHog/context-mill#342](https://github.com/PostHog/context-mill/pull/342), [PostHog/context-mill#255](https://github.com/PostHog/context-mill/pull/255)

**Frameworks.** `python`, `javascript_node`

**Wrong:**

```python
posthog.metrics.count("job.processed")
posthog.metrics.histogram("job.duration", ms, unit="ms")
sys.exit(0)   # exits before the flush interval
```

**Fixed:**

```python
posthog.metrics.count("job.processed")
posthog.metrics.histogram("job.duration", ms, unit="ms")
# short-lived processes (scripts, cron, serverless): flush before exit
posthog.metrics.flush()          # or shutdown()
# OTel path: provider.force_flush() / shutdown()
```

## Trace spans lost when the process exits

**Problem.** OpenTelemetry exporters and the tracing SDK export on an interval, and setup examples stop after registering the processor or wrapping work in a span. Agents also reach for shutdown(), which is wrong for a reused serverless handler: flush() (or forceFlush()) at the end of each invocation, shutdown() only when the process exits.

**Impact.** Silent: buffered spans are lost. Serverless handlers and scripts send nothing.

**Rule location.**

- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (OpenTelemetry path, 'Flush before exit with ForceFlush or Shutdown')
- [`context-mill: context/skills/tracing/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/tracing/description.md) (Key principles, Flushing, on main, not in the older local checkout)

**Sources.** [PostHog/context-mill#373](https://github.com/PostHog/context-mill/pull/373), [PostHog/context-mill#391](https://github.com/PostHog/context-mill/pull/391), [PostHog/context-mill#399](https://github.com/PostHog/context-mill/pull/399)

**Frameworks.** `go`, `python`, `javascript_node`, `serverless`, `opentelemetry`

**Wrong:**

```go
tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(posthogProcessor))
otel.SetTracerProvider(tp)
// main returns, no ForceFlush / Shutdown
```

**Fixed:**

```go
tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(posthogProcessor))
otel.SetTracerProvider(tp)
defer func() { _ = tp.Shutdown(ctx) }() // or tp.ForceFlush(ctx) before exit
// serverless handler: ForceFlush at the end of each invocation, Shutdown only on process exit
```

## LLM script exits before AI events flush

**Problem.** The LLM wrapper or OTel span processor makes capture invisible, so the agent never sees a capture call that needs a flush after it. The script prints its answer and exits cleanly.

**Impact.** Silent: the run completes with no error but no $ai\_generation events ever arrive.

**Rule location.**

- [`context-mill: context/commandments.yaml#python`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('In CLIs and scripts: MUST call posthog.shutdown() before exit', wrapper path)
- [`context-mill: context/skills/ai-observability/references/3-instrument.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/ai-observability/references/3-instrument.md) (OpenTelemetry path, 'Flush before exit with ForceFlush or Shutdown'), references/4-verify.md (verify table, 'a short script exits before the flush')
- [`wizard-workbench: services/pr-evaluator/prompts/evaluation-ai-observability.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-ai-observability.md) (as\_flushes\_before\_exit)

**Sources.** [PostHog/context-mill#319](https://github.com/PostHog/context-mill/pull/319), [PostHog/wizard-workbench#3358](https://github.com/PostHog/wizard-workbench/pull/3358), [`wizard-workbench: apps/ai-observability/anthropic/python-weather/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/ai-observability/anthropic/python-weather/README.md), [`wizard-workbench: services/pr-evaluator/prompts/evaluation-ai-observability.md`](https://github.com/PostHog/wizard-workbench/blob/main/services/pr-evaluator/prompts/evaluation-ai-observability.md)

**Frameworks.** `python`, `javascript_node`, `opentelemetry`, `anthropic`, `openai`, `go`

**Wrong:**

```python
def main():
    reply = client.chat.completions.create(model='gpt-5-mini', messages=messages)
    print(reply.choices[0].message.content)
# process exits here, queued events are lost
```

**Fixed:**

```python
reply = client.chat.completions.create(model='gpt-5-mini', messages=messages)
print(reply.choices[0].message.content)
posthog.shutdown()  # flush queued events before a short script exits
# OTel path: tracer_provider.force_flush() / shutdown() before exit
```

## Serverless MCP server relies on a SIGTERM flush

**Problem.** The SIGTERM-then-shutdown pattern is right for a long-running STDIO server, so agents reuse it for a stateless mcp-handler on Vercel, Workers or Lambda. There the function freezes and SIGTERM never fires.

**Impact.** Silent: batched $mcp\_\* tool-call events are lost at the end of each invocation.

**Rule location.**

- [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 6)
- [`wizard-workbench: apps/mcp-analytics/typescript-sdk/stdio-server/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/mcp-analytics/typescript-sdk/stdio-server/README.md)

**Sources.** [PostHog/context-mill#202](https://github.com/PostHog/context-mill/pull/202), [`wizard-workbench: apps/mcp-analytics/typescript-sdk/stdio-server/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/mcp-analytics/typescript-sdk/stdio-server/README.md)

**Frameworks.** `mcp-handler`, `vercel`, `cloudflare-workers`, `lambda`, `javascript_node`

**Wrong:**

```typescript
const handler = createMcpHandler((server) => {
  instrument(server, posthog)
})
process.on('SIGTERM', async () => { await posthog.shutdown() }) // never runs here
```

**Fixed:**

```typescript
// serverless / edge: flush at the end of each invocation
await posthog.flush()
// or, where supported:
ctx.waitUntil(posthog.flush())
// long-running STDIO / persistent HTTP: await posthog.shutdown() on SIGTERM
```

## Python MCP server exits without draining analytics

**Problem.** The instrument() path has its own in-flight queue on top of the PostHog client. Agents call only one of analytics.flush() and posthog.shutdown(), or neither.

**Impact.** Silent: in-flight auto-captured MCP events are dropped when the process exits.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 6, Python)

**Sources.** [PostHog/context-mill#205](https://github.com/PostHog/context-mill/pull/205)

**Frameworks.** `python`, `mcp`

**Wrong:**

```python
analytics = instrument(server, posthog)
server.run()
# exit: no await analytics.flush(), no posthog.shutdown()
```

**Fixed:**

```python
# long-running server (STDIO or persistent HTTP): drain on exit
await analytics.flush()   # waits for in-flight auto-capture events
posthog.shutdown()        # flushes and stops the client
```

## Cloudflare Worker ends before the batch sends

**Problem.** Agents copy the long-running Node pattern: a module-scope batching client that reads process.env. A Worker isolate can end as soon as the Response returns, and nothing errors.

**Impact.** Silent: the isolate terminates before the async batched send runs, and env values read at module scope may be undefined.

**Rule location.**

- wizard (main): src/programs/cloudflare-detection.ts (detectCloudflareTarget, fetchCloudflareReference, call site removed in #385, currently unwired)
- [`context-mill: context/docs.yaml`](https://github.com/PostHog/context-mill/blob/main/context/docs.yaml) id cloudflare-workers (release\_asset: true) fed from posthog.com/docs/libraries/cloudflare-workers.md

**Sources.** [PostHog/wizard#370](https://github.com/PostHog/wizard/pull/370), [PostHog/wizard#385](https://github.com/PostHog/wizard/pull/385), [wizard@e719244](https://github.com/PostHog/wizard/commit/e719244d), [PostHog/context-mill#104](https://github.com/PostHog/context-mill/pull/104), [posthog.com/docs/libraries/cloudflare-workers](https://posthog.com/docs/libraries/cloudflare-workers)

**Frameworks.** `cloudflare-workers`, `hono`, `astro`, `sveltekit`, `react-router`, `nuxt`, `nextjs`

**Wrong:**

```javascript
const posthog = new PostHog(process.env.POSTHOG_KEY, { host }) // module scope, batching
export default {
  async fetch(request, env, ctx) {
    posthog.capture({ distinctId, event: 'hello' })
    return new Response('ok') // isolate may end first
  },
}
```

**Fixed:**

```javascript
const posthog = new PostHog(env.POSTHOG_PROJECT_TOKEN, {
  host: env.POSTHOG_HOST, flushAt: 1, flushInterval: 0,
}) // new client per request, inside fetch
ctx.waitUntil(posthog.captureImmediate({ distinctId, event: 'hello_world_request' }))
ctx.waitUntil(posthog.shutdown())
return new Response('ok')
```

## Migration maps Statsig shutdown to PostHog everywhere

**Problem.** A one-to-one migration rewrites statsig.shutdown() and statsig.flush() as PostHog calls, but in browser code posthog-js has no matching teardown.

**Impact.** Runtime errors or dead calls in the browser, and real server teardown handlers handled wrongly.

**Rule location.** [`context-mill: context/skills/migrate/references/statsig/mapping.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/statsig/mapping.md) (Shutdown / flush)

**Sources.** [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142), [PostHog/wizard#474](https://github.com/PostHog/wizard/pull/474)

**Frameworks.** `javascript_web`, `javascript_node`, `python`

**Wrong:**

```diff
// browser code
- statsig.shutdown()
+ posthog.shutdown()
- statsig.flush()
+ posthog.flush()   // no client-side equivalent
```

**Fixed:**

```text
// statsig.shutdown(): ambiguous
//   client side: usually no PostHog teardown needed
//   clear server teardown handler: posthog.shutdown() (Node)
// statsig.flush() -> posthog.flush() server side only
// otherwise mark the site `warning`
```

## CLI exits on Ctrl+C or closed terminal before analytics flush

**Problem.** Interactive CLIs call process.exit() on cancel and ignore SIGHUP, so shutdown never runs. A naive added flush then double-fires the terminal event.

**Impact.** Silent: interrupted runs vanish from the funnel. #873 saw about 470 warehouse agent starts but fewer than 100 terminal events. #1417 saw 12-20% of integrate runs since 2.75.0 send only 'wizard: started'.

**Rule location.** wizard (main): src/tui/run-tool.ts (stop), src/tui/run.ts (onSignal), src/tui/start-tui.ts (onInterrupt), src/shared/utils/analytics.ts (terminalEventSent), src/cli/runners/signals.ts (underSignals incl. SIGHUP)

**Sources.** [PostHog/wizard#873](https://github.com/PostHog/wizard/pull/873), [PostHog/wizard#1416](https://github.com/PostHog/wizard/pull/1416), [PostHog/wizard#1417](https://github.com/PostHog/wizard/pull/1417)

**Frameworks.** `javascript_node`

**Wrong:**

```typescript
void waitUntilExit().then(() => {
  cleanup()
  process.exit(process.exitCode ?? 0) // analytics.shutdown() never runs
})
// no SIGHUP handler
```

**Fixed:**

```typescript
const stop = (code: number) => {
  unmountTui()
  void (async () => {
    try { await analytics.shutdown('cancelled') } catch { /* never block the end */ }
    exit.end(code)
  })()
}
// underSignals: SIGINT, SIGTERM, SIGHUP all abort the host
// shutdown(): terminalEventSent guard, first status wins
```

## Wrong waitUntil source per framework on Workers

**Problem.** Each framework exposes the Workers execution context in a different place, and Astro 6 removed locals.runtime, so a remembered pattern is often undefined.

**Impact.** ctx or runtime is undefined, so the request throws or the flush is skipped and events are lost.

**Rule location.** [`context-mill: context/docs.yaml`](https://github.com/PostHog/context-mill/blob/main/context/docs.yaml) (id cloudflare-workers, mirrors https://posthog.com/docs/libraries/cloudflare-workers.md, see its env-access table and the waitUntil table)

**Sources.** [PostHog/context-mill#104](https://github.com/PostHog/context-mill/pull/104), [posthog.com/docs/libraries/cloudflare-workers.md](https://posthog.com/docs/libraries/cloudflare-workers.md)

**Frameworks.** `astro`, `sveltekit`, `react-router`, `hono`, `cloudflare-workers`

**Wrong:**

```ts
// src/pages/api/track.ts (Astro 6 on Workers)
export const POST = async ({ locals }) => {
  const posthog = createPostHogClient(locals.runtime.env) // runtime removed in Astro 6
  locals.runtime.ctx.waitUntil(posthog.shutdown())
  return new Response('ok')
}
```

**Fixed:**

```ts
import { env, waitUntil } from 'cloudflare:workers'

export const POST = async () => {
  const posthog = createPostHogClient(env)
  // framework-agnostic; Astro 6 also exposes locals.cfContext.waitUntil
  waitUntil(posthog.shutdown())
  return new Response('ok')
}
```
