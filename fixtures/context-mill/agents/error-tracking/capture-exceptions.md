---
type: capture-exceptions
flow: error-tracking
label: Wire up exception capture
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [integration-v2-error-tracking-step, posthog-best-practices]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
disallowedTools: [enqueue_task]
dependsOn: [install, init]
---

## Goal

Make the errors the app does not catch reach PostHog, by whatever means the
SDK offers for that. Which means depends on the SDK: some autocapture
exceptions once you enable it at init, some wire into the framework's own
error handler, some give you a boundary to mount at the app entry. Follow the
docs and the reference example for this one, and set it up once per runtime —
never manual capture calls sprinkled across files.

An app that runs code on a server as well as in the browser has two runtimes,
and each needs its own capture. Cover every runtime the docs cover for this
framework and the app actually uses: the server side takes the SDK's server
library, where the framework hands you its errors (for Next.js,
`onRequestError` in `instrumentation.ts`). A browser-only setup leaves every
server error uncaptured. An Electron app has the same split: its main process
runs Node, and its uncaught errors never reach the renderer's capture, so the
main process takes the server library. A packaged app ships without the
developer's `.env`, so a runtime `process.env` lookup in the main process is
always empty there: read the token the way the bundler inlines it at build time
(electron-vite: `import.meta.env.MAIN_VITE_*`). A fully static app has no
server runtime to cover.

A page often shows two setups side by side: a global initializer, and an
explicit client you hold. Follow one of them the whole way through. Taking the
wiring from one and the calls from the other reads fine and compiles nowhere —
an initializer that hands back nothing leaves you nothing to call methods on.

The SDK is installed and initialized — either it already was, or the install
and init tasks before you did it (see their handoffs); build on that, do not
re-check it.

Install nothing except the server library your server-side capture imports,
when the manifest lacks it: add it with the project's package manager
(`detect_package_manager`). When it answers `No lockfile found. Default to
npm`, look up the tree first: in a workspace package, use the manager whose
lockfile sits at the workspace root above this directory, and npm only when no
parent holds a lockfile. Do not run tests or start the app, and do not touch
the build config: when the flow includes a configure task, it owns those files.
Stay inside this project's directory and set up capture in those places; that
is the whole job.

Each import needs its declaration in the manifest of the package that holds the
importing file. An app inside a workspace often nests its own package (a
`v2/package.json` below this directory): when the SDK sits in a different
manifest than the code that imports it, add it to the importing package too,
with the workspace's manager. Otherwise the import resolves only through
hoisting and breaks in a focused install or a container build.

Once your edits are in, run the project's build, or its typecheck when that
covers your files and is quicker, and fix what your edits broke. A failure
that was there before your edits is not yours: note it in your handoff and
leave it. Only a build the project defines in this checkout counts: a package
script or a compiler. Most Python, Ruby, and PHP apps have none, and then
there is nothing to run: do not create environments, install packages, or
reach for Docker to check your edit. Let the build check API names and types: write from the docs and
build, and open an SDK's type declarations only to fix an error the build
reports.

Build, never run: no command that installs or launches the app (`expo run:*`,
`react-native run-*`, `flutter run`), because it opens a simulator or an
emulator on the user's machine. Leave no build output the project does not
ignore: in Go, check with `go vet ./...`, because `go build ./...` writes a
main package's binary into the project root. Your shell gets a reduced
environment, so a build that cannot find an SDK (`SDK location not found`)
failed because of this shell, not your edit: do not retry it, and say so in
your handoff.

## Do not copy the SDK's own listeners

Exception autocapture already registers the global handlers: `window.onerror`
and `unhandledrejection` in the browser, `uncaughtException` and
`unhandledRejection` in Node, `sys.excepthook` in Python, the panic hook in
Rust, and the uncaught-exception and signal handlers on iOS and Android. Turn
that on with the SDK's own option — `capture_exceptions`,
`enableExceptionAutocapture`, `enable_exception_autocapture`, `capture_panics`,
`errorTrackingConfig.autoCapture` — and register none of those handlers
yourself. A second listener on the same event sends every error twice, and it
stops matching the SDK's handling the moment the SDK changes.

What the SDK cannot see is yours to add: errors a framework catches before any
global handler fires. Express error middleware, Fastify `setErrorHandler`, Hono
`onError`, Vue `app.config.errorHandler`, Angular `ErrorHandler`, SvelteKit
`handleError`, a React error boundary, Next.js `global-error` — hook those,
because the framework swallows the error and the global listener never hears
of it. NestJS is one more layer up: its exception filters answer every request
error before Express error middleware runs, so capture goes in a global filter
(the app's existing `@Catch()` filter when it has one), not in
`setupExpressErrorHandler`. A platform with no autocapture at all, such as Go,
is the other case: there the capture boundary at the entry point is the
mechanism, not a copy of one.

## How you know you succeeded

An error the app does not catch reaches PostHog from every runtime the app
runs in, through the mechanism each SDK gives you rather than one you invented,
and every PostHog library in the manifest is imported. No global error listener
of your own sits beside the SDK's autocapture. The project builds as well as it
did before your edits. You installed nothing but the server library your
capture imports, and did not run tests, search outside the project, or read
through the whole app or hand-wrap individual components or routes. Your handoff names the files you changed, the capture mechanism, and
the build command you ran with its result, so the report can explain it to the
user.
