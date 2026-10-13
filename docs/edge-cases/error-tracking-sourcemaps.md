# Errors not captured or unreadable

86 cases. Part of the [edge case catalogue](../edge-cases.md).

## Bundler config reads .env that nothing loads

**Problem.** The agent reads upload credentials with process.env in rollup or webpack config and assumes .env is loaded, as it is in a framework dev server. Plain bundler configs never load it.

**Impact.** Silent. Credentials are undefined at build time, so the source map upload fails or is skipped.

**Rule location.**

- [`wizard: src/programs/error-tracking-upload-source-maps/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/prompt.ts) (STEP 4)
- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Make credentials available at build time)

**Sources.** [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162)

**Frameworks.** `rollup`, `webpack`, `node`

**Wrong:**

```javascript
// rollup.config.js  (dotenv neither installed nor imported)
const apiKey = process.env.POSTHOG_API_KEY   // undefined
export default {
  plugins: [/* posthog source map plugin(apiKey) */],
}
```

**Fixed:**

```javascript
// rollup.config.js
import 'dotenv/config'   // dotenv added as a devDependency
const apiKey = process.env.POSTHOG_API_KEY
export default {
  plugins: [/* posthog source map plugin(apiKey) */],
}
```

## Vite config cannot see upload credentials

**Problem.** Agents assume Vite loads .env into process.env everywhere, but inside vite.config it does not, and loadEnv filters to VITE\_ vars unless the third argument is ''.

**Impact.** The source-map plugin gets undefined credentials, so upload is skipped or fails at build time.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Make credentials available at build time: 'Vite is a partial exception' tip and Vite example)

**Sources.** [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162)

**Frameworks.** `vite`

**Wrong:**

```javascript
export default defineConfig({
  plugins: [posthog({ personalApiKey: process.env.POSTHOG_API_KEY })], // undefined
});
```

**Fixed:**

```javascript
export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  return defineConfig({ plugins: [/* posthog source map plugin */] });
};
```

## posthog-cli build step gets no credentials

**Problem.** dotenv loaded in the bundler config looks global, but each posthog-cli call is a separate child process. The agent passes the env-file flag only on upload and leaves inject bare, and an old posthog-cli login masks the gap on the author's machine.

**Impact.** Source map upload works locally via ~/.posthog, then fails in CI and on teammates' machines.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Make credentials available at build time: 'Separate-process gotcha' and '`process` authenticates from the start' tips, Standalone posthog-cli step example)

**Sources.** [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/context-mill#167](https://github.com/PostHog/context-mill/pull/167), [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183), [PostHog/context-mill#194](https://github.com/PostHog/context-mill/pull/194), [PostHog/context-mill#253](https://github.com/PostHog/context-mill/pull/253)

**Frameworks.** `node`, `javascript-node`, `webpack`, `rollup`, `vite`, `rust`

**Wrong:**

```json
// package.json  (dotenv in the bundler config only affects that process)
"build": "tsc && posthog-cli sourcemap inject --directory ./dist && posthog-cli --dotenv-file .env sourcemap upload --directory ./dist"
// inject has no credentials; works only where `posthog-cli login` left ~/.posthog
```

**Fixed:**

```json
"build": "tsc && posthog-cli --dotenv-file .env sourcemap process --directory ./dist --release-name my-app"
// one authenticated step: process authenticates before it injects
// the flag goes before the subcommand (renamed from --env-file in #167)
```

## Upload credential names don't match the uploader

**Problem.** posthog-cli and the bundler plugins read different names (POSTHOG\_CLI\_\* vs POSTHOG\_\*), so the agent writes both to be safe, invents names, or creates a second env file, and never checks which one the wired mechanism reads. Parallel tasks each pick plausible names that disagree.

**Impact.** The uploader finds no key and skips upload with a clean build, so every stack trace stays minified. Or live credentials sit in the user's .env with no code reading them.

**Rule location.**

- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) ('Write one set only')
- [`context-mill: context/agents/error-tracking/configure.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/configure.md) credentials.md ('The names are a contract')
- [`wizard: src/programs/error-tracking-upload-source-maps/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/prompt.ts) (STEP 5, 'Write that one set only')

**Sources.** [PostHog/context-mill#368](https://github.com/PostHog/context-mill/pull/368), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162)

**Frameworks.** `vite`, `webpack`, `rollup`, `nextjs`, `javascript_node`, `all`

**Wrong:**

```bash
# .env after a Vite run: both sets as a hedge
POSTHOG_API_KEY=...
POSTHOG_PROJECT_ID=...
POSTHOG_CLI_API_KEY=...      # read by nothing
POSTHOG_CLI_PROJECT_ID=...   # read by nothing
# or: build config reads POSTHOG_API_KEY while another task wrote POSTHOG_CLI_*
# or: a new .env.posthog the build never reads
```

**Fixed:**

```text
# 1. check_env_keys first; if PostHog upload vars exist, read exactly those names
# 2. else write ONE set, for the mechanism wired, in the file that already has POSTHOG_*:
#    posthog-cli    -> POSTHOG_CLI_API_KEY / _PROJECT_ID / _HOST
#    bundler plugin -> POSTHOG_API_KEY / POSTHOG_PROJECT_ID / POSTHOG_HOST
# 3. name them in full in the handoff so credentials / wire-ci match
```

## Upload variable names differ between local and CI

**Problem.** Agents wire CI with a public-key-style name (POSTHOG\_API\_KEY) while .env uses POSTHOG\_CLI\_\*, or swap the personal key for the project token.

**Impact.** The build reads names CI never sets, so uploads are skipped even though secrets exist.

**Rule location.**

- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Set up CI for automatic uploads, Tips: 'Reuse the exact variable names')
- [`context-mill: context/agents/error-tracking/credentials.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/credentials.md) and wire-ci.md ('The names are a contract')

**Sources.** [PostHog/wizard#651](https://github.com/PostHog/wizard/pull/651), [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183), [PostHog/context-mill#368](https://github.com/PostHog/context-mill/pull/368)

**Frameworks.** `all`

**Wrong:**

```yaml
# .env
POSTHOG_CLI_API_KEY=...
# workflow
env:
  POSTHOG_API_KEY: ${{ secrets.POSTHOG_API_KEY }}
```

**Fixed:**

```yaml
# workflow reuses the exact names from the env file
env:
  POSTHOG_CLI_API_KEY: ${{ secrets.POSTHOG_CLI_API_KEY }}
  POSTHOG_CLI_PROJECT_ID: ${{ secrets.POSTHOG_CLI_PROJECT_ID }}
# POSTHOG_CLI_* for direct posthog-cli; POSTHOG_* for bundler-plugin uploaders
```

## Upload credentials never reach the CI build

**Problem.** Agents write POSTHOG\_CLI\_\* to the local .env and edit the bundler config, but never trace where the production build runs. Env does not cross into a Docker build, composite action or SSH session.

**Impact.** Deploys build fine, no symbol set uploads, and Error Tracking keeps showing minified stack traces.

**Rule location.**

- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Set up CI for automatic uploads, Examples: GitHub Actions docker/build-push-action, Dockerfile build stage, single-stage BuildKit secret)
- [`wizard: src/programs/error-tracking-upload-source-maps/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/prompt.ts) (STEP 7)

**Sources.** [PostHog/wizard#651](https://github.com/PostHog/wizard/pull/651), [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183), [PostHog/wizard-workbench#1855](https://github.com/PostHog/wizard-workbench/pull/1855)

**Frameworks.** `all`

**Wrong:**

```yaml
- name: Build and push image
  uses: docker/build-push-action@v6
  with:
    context: .
    push: true
# Dockerfile `RUN npm run build` sees no POSTHOG_CLI_* vars
```

**Fixed:**

```yaml
- name: Build and push image
  uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    build-args: |
      POSTHOG_CLI_API_KEY=${{ secrets.POSTHOG_CLI_API_KEY }}
      POSTHOG_CLI_PROJECT_ID=${{ secrets.POSTHOG_CLI_PROJECT_ID }}
# multi-stage: ARG/ENV in the build stage before the build RUN; single-stage: secrets: input + BuildKit secret
```

## Flutter native builds miss the root .env

**Problem.** Agents copy the Android and iOS examples verbatim, but in Flutter Gradle's root is android/ and Xcode's SRCROOT is ios/, so the dotenv path points one level too deep.

**Impact.** Upload steps cannot find credentials, and only appear to work if the developer once ran posthog-cli login.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Make credentials available at build time, Flutter bullet)

**Sources.** [PostHog/context-mill#281](https://github.com/PostHog/context-mill/pull/281)

**Frameworks.** `flutter`

**Wrong:**

```kotlin
// android/app/build.gradle.kts
val env = rootProject.file(".env")          // resolves to android/.env
# Xcode Run Script
POSTHOG_CLI_DOTENV_FILE="${SRCROOT}/.env"   # resolves to ios/.env
# web: flag after the subcommand
posthog-cli sourcemap process --dotenv-file .env --directory build/web
```

**Fixed:**

```kotlin
rootProject.file("../.env")                      // Gradle root is android/
POSTHOG_CLI_DOTENV_FILE="${SRCROOT}/../.env"     # SRCROOT is ios/
posthog-cli --dotenv-file .env sourcemap process --directory build/web  # flag BEFORE subcommand
```

## Gradle upload task ignores .env

**Problem.** Agents assume the build tool reads .env like JS bundlers do. Gradle does not, and the PostHog CLI exec task silently gets no credentials.

**Impact.** Android/Flutter symbol upload fails, or works only where posthog-cli login was run, so CI and teammates break.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Make credentials available at build time: 'Android / Gradle' bullet, build-config example 'Android (Gradle / posthog-cli)')

**Sources.** [PostHog/context-mill#253](https://github.com/PostHog/context-mill/pull/253)

**Frameworks.** `android`, `flutter`

**Wrong:**

```kotlin
// .env holds POSTHOG_CLI_API_KEY, POSTHOG_CLI_PROJECT_ID
// app/build.gradle.kts: PostHog plugin applied, no .env bridge
// PostHogCliExecTask gets no credentials
```

**Fixed:**

```kotlin
val postHogEnv = Properties().apply {
    rootProject.file(".env").takeIf { it.exists() }?.inputStream()?.use { load(it) } }
tasks.withType<PostHogCliExecTask>().configureEach {
    postHogEnv.getProperty("POSTHOG_CLI_API_KEY")?.let { postHogApiKey.set(it) }
    postHogEnv.getProperty("POSTHOG_CLI_PROJECT_ID")?.let { postHogProjectId.set(it) }
    postHogEnv.getProperty("POSTHOG_CLI_HOST")?.let { postHogHost.set(it) }
}  // unset props fall back to POSTHOG_CLI_* env vars in CI
```

## Report promises source-map uploads that cannot run

**Problem.** Once the build command is wired, the agent reports uploads as working even when the credentials or CI step was skipped, and nothing errors until a build runs without the key.

**Impact.** The user trusts symbolication that never happens. The build exits 1 until POSTHOG\_CLI\_\* values are set.

**Rule location.** [`context-mill: context/agents/error-tracking/report.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/report.md)

**Sources.** [PostHog/context-mill#408](https://github.com/PostHog/context-mill/pull/408), [PostHog/wizard#1329](https://github.com/PostHog/wizard/issues/1329), [PostHog/context-mill#377](https://github.com/PostHog/context-mill/pull/377)

**Frameworks.** `javascript-node`, `all`

**Wrong:**

```markdown
## What changed
- Source map upload wired into `npm run build`.
- Every production build now uploads source maps to PostHog.
(credentials handoff: skipped; wire-ci handoff: skipped)
```

**Fixed:**

```markdown
- Build is set up to upload. Uploads start, and the build command succeeds,
  only once the POSTHOG_CLI_* values are present where the build runs.
("every production build now uploads" only when neither credentials nor wire-ci reports a skip)
```

## iOS dSYM upload tested with a Debug build

**Problem.** The agent builds with xcodebuild or the default Debug scheme, but only the Release configuration produces and uploads dSYMs.

**Impact.** The test never exercises the upload and the stack trace stays unsymbolicated.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (iOS build/run, iOS test flow)

**Sources.** [PostHog/context-mill#229](https://github.com/PostHog/context-mill/pull/229)

**Frameworks.** `ios`, `swift`

**Wrong:**

```sh
xcodebuild -scheme MyApp -configuration Debug build
# launch on simulator, tap the test button, check Error Tracking
```

**Fixed:**

```text
# Local build + run is one step, in Xcode:
# Edit Scheme > Run > Build Configuration > Release, then Run
# The Release build uploads dSYMs automatically. xcodebuild is CI-only.
```

## Go binary tested without re-uploading symbols

**Problem.** Every Go build has its own identity (GNU build ID on Linux, Mach-O UUID on macOS), so symbols uploaded for an earlier build do not match. The failure looks like broken wiring rather than a stale upload.

**Impact.** Silent: the test exception arrives unsymbolicated.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Go bullet, 'Identify the build and run commands' Go line, Go test flow)

**Sources.** [PostHog/context-mill#299](https://github.com/PostHog/context-mill/pull/299)

**Frameworks.** `go`

**Wrong:**

```bash
go build -o bin/app . && ./bin/app   # upload skipped, or done for an earlier build
```

**Fixed:**

```bash
# Linux; on macOS use -ldflags="-compressdwarf=false" instead
go build -ldflags="-B gobuildid" -o bin/<app> . \
  && posthog-cli --dotenv-file .env symbol-sets upload --directory ./bin
./bin/<app>   # the binary whose symbols were just uploaded
```

## Generic CLI bolted onto framework source maps

**Problem.** Appending posthog-cli to the build script is the generic recipe, but Next.js, Nuxt and Angular own their build pipelines and have dedicated integrations.

**Impact.** Upload runs against the wrong output or misses framework bundles. Nuxt 3.6 vs 3.7+ differences ignored.

**Rule location.**

- [`wizard: src/programs/error-tracking-upload-source-maps/detect.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/detect.ts) (pickJsVariant)
- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) ('Next.js / Nuxt / Angular' bullet)

**Sources.** [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162)

**Frameworks.** `nextjs`, `nuxt`, `angular`

**Wrong:**

```json
"build": "next build && posthog-cli sourcemap process --directory .next"
```

**Fixed:**

```typescript
// detect.ts pickJsVariant: react-native, nuxt, next, @angular/core come first,
// before vite/webpack/rollup/react/node/web: they own their build pipeline
// skill: "Use the framework's documented source-map upload integration...
// configure upload there rather than bolting on a separate CLI step"
// (references split Nuxt 3.6- and 3.7+)
```

## React Native repo gets the iOS dSYM uploader

**Problem.** A React Native or Flutter repo carries ios/Podfile, .xcodeproj and Gradle files, so it looks exactly like a native app.

**Impact.** Native dSYM or Gradle upload is wired in, JavaScript source maps are never uploaded, and every JS stack trace stays minified.

**Rule location.**

- [`context-mill: context/agents/error-tracking/setup-error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/setup-error-tracking.md) (fact 2, uploader variant precedence)
- [`wizard: src/programs/error-tracking-upload-source-maps/detect-agentic.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/detect-agentic.ts) (VARIANT\_PRECEDENCE)

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/wizard#941](https://github.com/PostHog/wizard/pull/941), [PostHog/wizard#985](https://github.com/PostHog/wizard/pull/985)

**Frameworks.** `react-native`, `expo`, `flutter`, `android`, `ios`

**Wrong:**

```text
repo: package.json (react-native), ios/Podfile, android/build.gradle
agent picks variant: ios  -> Run Script dSYM wiring in ios/
```

**Fixed:**

```text
first match wins:
1. react-native or expo in package.json deps -> react-native
2. pubspec.yaml -> flutter
3. .xcodeproj / Podfile / Package.swift -> ios
4. Gradle with com.android.application|library -> android
```

## Source map upload breaks Astro builds

**Problem.** Astro depends on vite, so the Vite upload plugin looks right, but Astro inlines small scripts and emits .map files with no matching .js.

**Impact.** The upload step exits non-zero and fails the whole production build.

**Rule location.** [`context-mill: context/agents/error-tracking/setup-error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/setup-error-tracking.md) (astro -> none)

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `astro`

**Wrong:**

```javascript
// astro.config.mjs
vite: { plugins: [ /* PostHog sourcemap upload plugin */ ] }
// build: .map with no matching .js -> upload exits non-zero
```

**Fixed:**

```text
astro in package.json deps -> uploader variant: none
(wins over a vite dependency; build command left untouched)
report: Astro is not supported by the uploader
```

## Composite GitHub action reads secrets directly

**Problem.** ${{ secrets.\* }} works in workflow files, so the agent uses it inside a local composite action.yml, where only inputs.\* is available and the value is silently empty.

**Impact.** The build arg is empty, credentials never reach the Docker build, and source-map upload silently fails.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Composite / reusable actions tip, and the nested/composite action example)

**Sources.** [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183), [PostHog/wizard-workbench#1855](https://github.com/PostHog/wizard-workbench/pull/1855), [PostHog/wizard#651](https://github.com/PostHog/wizard/pull/651)

**Frameworks.** `github-actions`

**Wrong:**

```yaml
# .github/actions/build-and-push/action.yml
build-args: |
  POSTHOG_CLI_API_KEY=${{ secrets.POSTHOG_CLI_API_KEY }}
```

**Fixed:**

```yaml
# action.yml
inputs:
  posthog-cli-api-key: { required: true }
# ...
build-args: |
  POSTHOG_CLI_API_KEY=${{ inputs.posthog-cli-api-key }}
# caller: with: posthog-cli-api-key: ${{ secrets.POSTHOG_CLI_API_KEY }}
```

## Tooling Gemfile mistaken for a Ruby server

**Problem.** A Gemfile, requirements.txt or composer.json looks like proof of a server app, but in a mobile or Node repo it often only holds CocoaPods, fastlane or scripts.

**Impact.** A mobile app or Node service gets release-linking deploy and CI edits meant for a server language.

**Rule location.** [`context-mill: context/agents/error-tracking/setup-error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/setup-error-tracking.md) (fact 3, release-linking variant)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `react-native`, `ruby`, `python`, `php`

**Wrong:**

```text
React Native app with a Gemfile (CocoaPods/fastlane)
-> classified as Ruby server
-> link-releases queued, CI and deploy files edited
```

**Fixed:**

```text
A manifest that only carries tooling for another platform does not count:
a Gemfile for CocoaPods or fastlane beside a mobile app, or a requirements.txt
for scripts beside a Node service. Mobile uploader variants always mean none.
```

## Symbol upload wired into a pure Dart package

**Problem.** A pubspec.yaml looks like a Flutter app, but a package or plugin has no web/, android/ or ios/ target and never produces an app build.

**Impact.** The post-build upload step has nothing to upload, so it fails or does nothing.

**Rule location.** [`wizard: src/programs/error-tracking-upload-source-maps/detect-agentic.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/detect-agentic.ts) (projectHasBuildTarget, FLUTTER\_NO\_BUILD\_TARGET\_REASON)

**Sources.** [PostHog/wizard#985](https://github.com/PostHog/wizard/pull/985)

**Frameworks.** `flutter`, `dart`

**Wrong:**

```bash
# flutter_plugin/ has lib/ and pubspec.yaml only
flutter build web --source-maps
posthog-cli sourcemap process --directory build/web   # no web/ target
```

**Fixed:**

```ts
function projectHasBuildTarget(installDir, projectPath) {
  const root = join(installDir, projectPath);
  return existsSync(join(root, 'web', 'index.html')) ||
         existsSync(join(root, 'android')) || existsSync(join(root, 'ios'));
}
// else blocked: 'Flutter project has no web, android or ios target — nothing to upload symbols for'
```

## Test cleanup also reverts the real setup

**Problem.** 'Restore every touched file' after a temporary test button reads as reverting everything the task changed, and the rollback is silent.

**Impact.** The source-map upload and credential wiring the user asked for are rolled back with the test button, so production builds upload nothing.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (test affordance rules)

**Sources.** [PostHog/context-mill#229](https://github.com/PostHog/context-mill/pull/229)

**Frameworks.** `all`

**Wrong:**

```shell
# cleanup after the test
git checkout -- .   # also restores the Run Script phase, build settings and .env wiring
```

**Fixed:**

```text
After testing, restore every file the affordance touched - the affordance
only, leave the upload and credential wiring in place - and re-read to
confirm nothing is left behind.
```

## Agent invents a CI workflow it cannot trace

**Problem.** Needing somewhere to put upload secrets, the agent copies a sibling package's workflow or writes one from scratch rather than admitting it could not find the real deploy path.

**Impact.** An invented, unreviewed pipeline that does not match the real deploy, while the real build still has no credentials.

**Rule location.**

- [`wizard: src/programs/error-tracking-upload-source-maps/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/prompt.ts) (STEP 7, 'do NOT invent config that isn't there', src/lib/programs/... in older checkouts)
- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Set up CI for automatic uploads, sibling-package bullet, Untraceable setup)

**Sources.** [PostHog/wizard#651](https://github.com/PostHog/wizard/pull/651), [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183), [PostHog/context-mill#194](https://github.com/PostHog/context-mill/pull/194)

**Frameworks.** `github-actions`, `gitlab-ci`, `docker`, `all`

**Wrong:**

```yaml
# repo has .github/workflows/deploy-backend.yml only; agent creates:
# .github/workflows/deploy-frontend.yml
- run: npm run build
  env:
    POSTHOG_CLI_API_KEY: ${{ secrets.POSTHOG_CLI_API_KEY }}
```

**Fixed:**

```text
Only ever edit CI/deploy files that already exist - never create a new
workflow, pipeline, or deploy file. Untraceable setup: make no CI changes
and tell the user that wherever their production build command runs, it
must have the upload credentials (POSTHOG_CLI_* / POSTHOG_*) available as
environment variables, or maps won't upload on deploy.
```

## Node server errors never reach Error Tracking

**Problem.** Server SDKs leave exception autocapture off by default, and the analytics quickstart never mentions it. Even with enableExceptionAutocapture on, the Express/Fastify/Koa error middleware catches route errors first, so the global hook never hears of them.

**Impact.** Silent: handled and unhandled server errors returned as 500s never appear in Error Tracking, though events flow normally.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_node`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (enableExceptionAutocapture and captureException-in-error-handler lines)
- [`context-mill: context/agents/error-tracking/capture-exceptions.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/capture-exceptions.md) (on main, not in the stale local checkout)
- [`context-mill: example-apps/javascript-node/todo.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/javascript-node/todo.js) (global error middleware)

**Sources.** [context-mill@e393145](https://github.com/PostHog/context-mill/commit/e393145c), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/wizard-workbench#3038](https://github.com/PostHog/wizard-workbench/pull/3038), [PostHog/wizard-workbench#4457](https://github.com/PostHog/wizard-workbench/pull/4457)

**Frameworks.** `javascript_node`, `express`, `fastify`, `koa`, `hono`

**Wrong:**

```javascript
const posthog = new PostHog(token, { host })
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal error' })
})
```

**Fixed:**

```javascript
const posthog = new PostHog(token, { host, enableExceptionAutocapture: true })
app.use((err, req, res, next) => {
  posthog.captureException(err, req.user?.id)
  res.status(500).json({ error: 'Internal error' })
})
// Express alternative the wizard also emits: setupExpressErrorHandler(posthog, app)
```

## Python client built without exception autocapture

**Problem.** The minimal Posthog(token, host=...) constructor from docs looks complete, and enable\_exception\_autocapture is opt-in, so nothing hints that crashes go unreported.

**Impact.** Silent: crashes produce no $exception events and Error Tracking stays empty.

**Rule location.**

- [`context-mill: context/commandments.yaml#python`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (Always include enable\_exception\_autocapture=True), #django (PosthogContextMiddleware)
- [`context-mill: example-apps/python/todo.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/python/todo.py)

**Sources.** [PostHog/wizard#254](https://github.com/PostHog/wizard/pull/254), [PostHog/context-mill#70](https://github.com/PostHog/context-mill/pull/70)

**Frameworks.** `python`, `django`, `fastapi`

**Wrong:**

```python
posthog_client = Posthog(
    os.getenv("POSTHOG_PROJECT_TOKEN"),
    host=os.getenv("POSTHOG_HOST"),
)
```

**Fixed:**

```python
posthog_client = Posthog(
    os.getenv("POSTHOG_PROJECT_TOKEN"),
    host=os.getenv("POSTHOG_HOST"),
    enable_exception_autocapture=True,
)
# Django: MIDDLEWARE += ['posthog.integrations.django.PosthogContextMiddleware']
```

## Nuxt module set up without error tracking

**Problem.** @posthog/nuxt works with only a key and host. Client capture, server capture and source maps are separate opt-in blocks with different option names (capture\_exceptions vs enableExceptionAutocapture), and the personal key must stay out of public runtime config.

**Impact.** Silent: unhandled Vue errors and Nitro request errors never reach Error Tracking, and client stack traces stay minified.

**Rule location.**

- [`context-mill: example-apps/nuxt-4/nuxt.config.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-4/nuxt.config.ts) and its README
- [`context-mill: context/skills/integration-v2/error-tracking-step/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/error-tracking-step/config.yaml) (nuxt-3-6 and nuxt-4 variants with docs URLs). No Nuxt section exists in commandments.yaml

**Sources.** [PostHog/context-mill#62](https://github.com/PostHog/context-mill/pull/62), [PostHog/context-mill#92](https://github.com/PostHog/context-mill/pull/92), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `nuxt`

**Wrong:**

```typescript
export default defineNuxtConfig({
  modules: ['@posthog/nuxt'],
  posthogConfig: { publicKey, host },
})
```

**Fixed:**

```typescript
posthogConfig: {
  publicKey, host,
  clientConfig: { capture_exceptions: true },          // client side (Vue)
  serverConfig: { enableExceptionAutocapture: true },  // server side (Nitro)
  sourcemaps: { enabled: true, envId: process.env.PROJECT_ID || '',
    personalApiKey: process.env.PERSONAL_API_KEY || '' },
}  // personal key stays out of runtimeConfig.public
```

## Flask error handlers hide exceptions from PostHog

**Problem.** Agents trust SDK autocapture, but Flask turns exceptions into responses in its own errorhandler first, so the exception is handled and autocapture never fires.

**Impact.** Silent: Flask 500s never reach Error Tracking.

**Rule location.**

- [`context-mill: context/commandments.yaml#flask`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (Manually capture exceptions with posthog.capture\_exception(e) ... Flask has built-in error handlers)
- [`context-mill: example-apps/flask/app/api/routes.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/flask/app/api/routes.py) (test\_error). Note example-apps/flask/app/\_\_init\_\_.py intentionally does not capture in its errorhandlers

**Sources.** [context-mill@d34e9af](https://github.com/PostHog/context-mill/commit/d34e9af2), [context-mill@6295b0e](https://github.com/PostHog/context-mill/commit/6295b0e8), [PostHog/wizard-workbench#4433](https://github.com/PostHog/wizard-workbench/pull/4433)

**Frameworks.** `flask`

**Wrong:**

```python
@app.errorhandler(500)
def internal_server_error(e):
    return render_template('errors/500.html'), 500  # PostHog never sees e
```

**Fixed:**

```python
@app.errorhandler(Exception)
def handle(e):
    if isinstance(e, HTTPException):
        return e
    posthog.capture_exception(e)
    return render_template('500.html'), 500
# routes.py example adds user context:
#   with new_context(): identify_context(str(current_user.id)); posthog.capture_exception(e)
```

## Browser SDK installed with exception capture off

**Problem.** The agent treats 'add PostHog' as analytics only and copies an analytics-only init snippet. Capture\_exceptions is opt-in, so nothing breaks until a user opens an empty Error Tracking tab.

**Impact.** Silent: uncaught browser errors never reach PostHog. Users conclude Error Tracking does not work.

**Rule location.**

- [`context-mill: context/skills/integration-v2/error-tracking-step/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/error-tracking-step/description.md)
- [`context-mill: context/agents/error-tracking/capture-exceptions.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/capture-exceptions.md) (main only)
- [`context-mill: example-apps/next-app-router/instrumentation-client.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/instrumentation-client.ts)
- [`context-mill: example-apps/tanstack-start/src/routes/__root.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/tanstack-start/src/routes/__root.tsx)

**Sources.** [PostHog/wizard#720](https://github.com/PostHog/wizard/pull/720), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/wizard-workbench#872](https://github.com/PostHog/wizard-workbench/pull/872), [PostHog/wizard-workbench#1987](https://github.com/PostHog/wizard-workbench/pull/1987), [PostHog/wizard-workbench#4381](https://github.com/PostHog/wizard-workbench/pull/4381)

**Frameworks.** `javascript_web`, `react`, `nextjs`, `vue`, `astro`, `tanstack-start`

**Wrong:**

```javascript
posthog.init(apiKey, { api_host: '/ingest', defaults: '2026-01-30' })
// no capture_exceptions, no captureException anywhere
// React: <PostHogProvider apiKey={key} options={{ api_host: '/ingest' }}>
```

**Fixed:**

```javascript
posthog.init(apiKey, {
  api_host: '/ingest',
  defaults: '2026-01-30',
  capture_exceptions: true, // unhandled exceptions -> Error Tracking
})
```

## Manual captures sprinkled across every route

**Problem.** Asked to 'add error tracking', a thorough agent reads the whole app and wraps each component, route and view in try/catch, which looks diligent but covers only what it touched.

**Impact.** Large noisy diff across unrelated files, a long-running step, partial coverage, and errors outside the wrapped code still go unreported.

**Rule location.**

- [`context-mill: context/agents/integration-v2/error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/error-tracking.md)
- [`context-mill: context/agents/error-tracking/capture-exceptions.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/capture-exceptions.md) (main only)
- [`context-mill: context/skills/integration-v2/error-tracking-step/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/error-tracking-step/description.md)

**Sources.** [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `all`

**Wrong:**

```javascript
async function loadProfile() {
  try { return await api.get('/profile') }
  catch (e) { posthog.captureException(e); throw e } // x14 files
}
```

**Fixed:**

```javascript
// once at init
posthog.init(token, { capture_exceptions: true })
// once in the framework's own handler (Vue shown)
app.config.errorHandler = (err) => {
  posthog.captureException(err)
}
```

## Hand-built global handler where SDK has a flag

**Problem.** Told to wire 'a single global error boundary', the agent builds one (sys.excepthook, a custom React boundary) even when the SDK just needs an init option or already ships the mechanism.

**Impact.** Fragile or duplicate capture that bypasses the SDK's own mechanism and drifts as the SDK changes.

**Rule location.** [`context-mill: context/agents/integration-v2/error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/error-tracking.md) (Goal)

**Sources.** [context-mill@5496965](https://github.com/PostHog/context-mill/commit/54969658), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `python`, `javascript_node`, `react`, `rust`, `ios`, `android`

**Wrong:**

```python
def _hook(t, v, tb):
    posthog.capture_exception(v)
    sys.__excepthook__(t, v, tb)
sys.excepthook = _hook
```

**Fixed:**

```python
posthog = Posthog(api_key, host=host,
                  enable_exception_autocapture=True)
```

## Autocapture option copied from the wrong SDK

**Problem.** posthog-js uses capture\_exceptions while posthog-node uses enableExceptionAutocapture. Training data mixes them, and an unknown init option is silently ignored.

**Impact.** Silent: the option does nothing, errors never reach PostHog, and the report still claims error tracking is on.

**Rule location.**

- [`context-mill: context/agents/error-tracking/capture-exceptions.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/capture-exceptions.md) ('Do not copy the SDK's own listeners', lists capture\_exceptions vs enableExceptionAutocapture)
- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (node block, line 62, has only the node option, the posthog-js contrast is in open PR 277)
- [`context-mill: context/skills/posthog-best-practices/references/error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/error-tracking.md)

**Sources.** [PostHog/context-mill#277](https://github.com/PostHog/context-mill/pull/277), [`context-mill: context/agents/error-tracking/capture-exceptions.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/capture-exceptions.md), [PostHog/wizard-workbench#4436](https://github.com/PostHog/wizard-workbench/pull/4436), [PostHog/wizard-workbench#4387](https://github.com/PostHog/wizard-workbench/pull/4387)

**Frameworks.** `javascript_web`, `nextjs`, `nuxt`, `sveltekit`, `remix`

**Wrong:**

```javascript
// posthog-js client, option from posthog-node docs
posthog.init(token, { enableExceptionAutocapture: true })
```

**Fixed:**

```javascript
posthog.init(token, { capture_exceptions: true })
```

## Extra global error listener beside SDK autocapture

**Problem.** Enabling autocapture looks too passive, so the agent also registers window.onerror, unhandledrejection, uncaughtException or sys.excepthook handlers the SDK already owns.

**Impact.** Silent: every uncaught error is sent twice, doubling issue counts and cost, and the copy drifts from SDK behavior.

**Rule location.** [`context-mill: context/agents/error-tracking/capture-exceptions.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/capture-exceptions.md) ('Do not copy the SDK's own listeners', success criterion 'no global error listener of your own sits beside the SDK's autocapture')

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `all`

**Wrong:**

```javascript
posthog.init(token, { capture_exceptions: true })
window.addEventListener('error', e => posthog.captureException(e.error))
window.addEventListener('unhandledrejection', e =>
  posthog.captureException(e.reason))
```

**Fixed:**

```javascript
posthog.init(token, { capture_exceptions: true }) // SDK owns the global handlers
// add only what the SDK cannot see: Express error middleware,
// Vue app.config.errorHandler, Angular ErrorHandler,
// SvelteKit handleError, React error boundary, Next.js global-error
```

## One failure captured at several layers

**Problem.** Told to add tracking 'around critical flows and API boundaries', the agent logs, captures and rethrows at each layer and also captures expected outcomes like validation 4xx.

**Impact.** Silent: one failure becomes several issues, inflating error counts, noise and cost.

**Rule location.**

- [`context-mill: context/skills/integration-v2/error-tracking-step/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/error-tracking-step/description.md) ('worth a single edit', 'the global handler is the floor')
- [`context-mill: context/skills/integration/description.md#Error`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/description.md) tracking (the generic 'around critical user flows and API boundaries' wording that causes the issue)

**Sources.** [PostHog/context-mill#407](https://github.com/PostHog/context-mill/issues/407), [`wizard-workbench: apps/error-tracking/README.md`](https://github.com/PostHog/wizard-workbench/blob/main/apps/error-tracking/README.md)

**Frameworks.** `all`

**Wrong:**

```javascript
try { await charge(order) } catch (e) {
  logger.error(e); posthog.captureException(e); throw e
}   // global handler captures it again
// also captures validation 4xx
```

**Fixed:**

```javascript
// global handler or autocapture is the floor
// capture at a natural boundary only in a single edit,
// not sprinkled across files
```

## Exceptions sent as hand-built $exception events

**Problem.** capture('$exception', {...}) looks equivalent and shows up in the live feed, and older SDKs and examples did it, but only captureException builds the $exception\_list and fingerprint. Property names without the $ prefix are not parsed at all.

**Impact.** Silent: events arrive but Error Tracking shows no usable issue, grouping or stack frames.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/references/error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/error-tracking.md) (rule 1)
- [`context-mill: example-apps/laravel/app/Services/PostHogService.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/laravel/app/Services/PostHogService.php)
- `context-mill: example-apps/{angular,expo,react-native,ruby}`

**Sources.** [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#152](https://github.com/PostHog/context-mill/pull/152), [context-mill@ad3c7c2](https://github.com/PostHog/context-mill/commit/ad3c7c25dd3df973cb65d9f91cafc13a75bd774f), [context-mill@7bb9d44](https://github.com/PostHog/context-mill/commit/7bb9d4456eca25351113ec595f71211c05d09345), [PostHog/context-mill#262](https://github.com/PostHog/context-mill/pull/262), [context-mill@8092ddb](https://github.com/PostHog/context-mill/commit/8092ddbf0d58548bf07886423ca888dd0fbd7096), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181)

**Frameworks.** `laravel`, `php`, `angular`, `react-native`, `expo`, `ruby`, `javascript_web`

**Wrong:**

```php
$this->capture($distinctId, '$exception', [
    'exception_type' => get_class($exception),
    'exception_message' => $exception->getMessage(),
    'stack_trace' => $exception->getTraceAsString(),
]);
// JS: posthog.capture('$exception', { $exception_type: error.name, ... })
```

**Fixed:**

```php
PostHog::captureException($exception, $distinctId, [
    'error_id' => $eventId,
]);  // posthog-php ^4.2
// browser / React Native:
posthog.captureException(error, { screen: 'Profile' })
// Ruby: posthog.capture_exception(e, distinct_id)
```

## Go errors captured by hand, not SDK helpers

**Problem.** posthog-go has no captureException-like method, so the agent mirrors JS wording by enqueuing a generic Capture (named $exception or 'error'), missing NewDefaultException and the slog handler.

**Impact.** Silent: events lack the exception shape or are not $exception at all, so Error Tracking stays empty or cannot group them.

**Rule location.**

- [`context-mill: context/commandments.yaml#go`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: example-apps/go/handlers.go`](https://github.com/PostHog/context-mill/blob/main/example-apps/go/handlers.go)

**Sources.** [PostHog/context-mill#153](https://github.com/PostHog/context-mill/pull/153), [PostHog/context-mill#262](https://github.com/PostHog/context-mill/pull/262), [PostHog/context-mill#267](https://github.com/PostHog/context-mill/pull/267)

**Frameworks.** `go`

**Wrong:**

```go
client.Enqueue(posthog.Capture{
	DistinctId: uid,
	Event:      "$exception", // or "error"
	Properties: posthog.NewProperties().
		Set("exception_message", err.Error()),
})
```

**Fixed:**

```go
client.Enqueue(posthog.NewDefaultException(
	time.Now(), uid, "ProfileDataError", err.Error()))
// "ProfileDataError" is the exception type, shown as the title
// or wrap log/slog for warning-and-above capture:
// posthog.NewSlogCaptureHandler(...)
```

## Console errors and extension noise left on

**Problem.** Turning on every capture\_exceptions sub-option looks thorough, and console errors and browser-extension noise look like real errors until the bill arrives.

**Impact.** Cost: console errors and extension noise are ingested, triaged and billed, burying real issues.

**Rule location.** [`context-mill: context/skills/posthog-best-practices/references/error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/error-tracking.md) (rules 3-5)

**Sources.** [PostHog/context-mill#407](https://github.com/PostHog/context-mill/issues/407), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108)

**Frameworks.** `javascript_web`, `react`, `nextjs`

**Wrong:**

```javascript
posthog.init(token, {
  capture_exceptions: {
    capture_unhandled_errors: true,
    capture_unhandled_rejections: true,
    capture_console_errors: true,
  },
})
```

**Fixed:**

```javascript
posthog.init(token, {
  capture_exceptions: {
    capture_unhandled_errors: true,
    capture_unhandled_rejections: true,
    capture_console_errors: false,
  },
  before_send: dropKnownNoise,
})
```

## Source maps generated but never uploaded

**Problem.** The agent turns on exception capture or sourcemap generation and stops, because errors do arrive and the report says 'exceptions are captured'. Nothing errors when maps never reach PostHog.

**Impact.** Silent: production stack traces stay minified (frames like lt / ct in dist/index.js:2:90646), or fail to match because deployed assets were never injected.

**Rule location.**

- [`wizard: src/programs/error-tracking-upload-source-maps/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/prompt.ts) and src/programs/error-tracking
- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md)
- [`context-mill: context/skills/posthog-best-practices/references/error-tracking.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/error-tracking.md)
- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) (line ~122)

**Sources.** [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/wizard#595](https://github.com/PostHog/wizard/pull/595), [PostHog/wizard#1185](https://github.com/PostHog/wizard/pull/1185), [PostHog/wizard#1329](https://github.com/PostHog/wizard/issues/1329), [PostHog/wizard#447](https://github.com/PostHog/wizard/issues/447), [PostHog/context-mill#92](https://github.com/PostHog/context-mill/pull/92), [PostHog/context-mill#96](https://github.com/PostHog/context-mill/pull/96), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162), [PostHog/context-mill#174](https://github.com/PostHog/context-mill/pull/174), [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183)

**Frameworks.** `javascript_node`, `react`, `nextjs`, `vue`, `angular`, `nuxt`, `sveltekit`, `astro`, `react-vite`

**Wrong:**

```json
"build": "esbuild index.js --bundle --platform=node --sourcemap=external --outfile=dist/index.js"
// no posthog plugin or CLI step; CI deploys dist/ as is
// frontend: "build": "vite build"   // no upload anywhere
```

**Fixed:**

```json
"build": "esbuild index.js ... --sourcemap=external --sources-content=true --outfile=dist/index.js && posthog-cli --dotenv-file .env sourcemap process --directory ./dist --release-name express-todo"
// or @posthog/webpack-plugin / rollup-plugin with deleteAfterUpload
// handoff: - [ ] Wire source-map upload into CI so production stack traces de-minify
```

## Existing PostHog setup skips source map upload

**Problem.** The agent treats 'PostHog is already integrated' as 'nothing left to do', and assumes a tsc-built Node service has readable stack traces. Those are two separate questions.

**Impact.** Production stack traces stay compiled or minified in an otherwise complete setup. Nothing reports the gap.

**Rule location.** context-mill (main, absent from the older local checkout): context/agents/error-tracking/setup-error-tracking.md

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/wizard#1185](https://github.com/PostHog/wizard/pull/1185)

**Frameworks.** `node`, `all`

**Wrong:**

```text
plan: posthog-node present -> integrated -> done
(no upload step queued for a Node service built with tsc)
```

**Fixed:**

```text
The three facts are independent: settle ALL of them before you enqueue anything.
"PostHog is already integrated" answers fact 1 only; it never decides fact 2 or fact 3,
and an already-integrated project still gets the upload subgraph when a variant matches.
A Node service built with `tsc` ships compiled output, so it is the `node` variant, not "none".
Only two kinds of project skip the upload subgraph: the readable-stack platforms, and Astro.
```

## Maps uploaded without chunk ID injection

**Problem.** 'Upload the source maps' reads as one step, but PostHog matches maps to bundles by an injected chunkId comment, which a bare upload never adds.

**Impact.** Silent: uploaded maps cannot be matched to deployed bundles, so traces stay minified.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Apply build-config changes, Tips)

**Sources.** [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162)

**Frameworks.** `javascript_node`, `webpack`, `rollup`, `vite`

**Wrong:**

```json
"build": "tsc && posthog-cli sourcemap upload --directory ./dist"
// bundles in ./dist have no //# chunkId comment
```

**Fixed:**

```json
"build": "tsc && posthog-cli --dotenv-file .env sourcemap process --directory ./dist --release-name my-app"
// process = inject chunk IDs + upload; deploy the injected files
```

## Source maps emitted without original source

**Problem.** The agent wires the uploader but leaves tsc or the bundler emitting no maps, or maps without sourcesContent, because sourceMap: true alone looks sufficient.

**Impact.** Silent: nothing to upload, or PostHog has line/column mappings but no code, so traces never fully resolve.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Apply build-config changes, Node / tsc)

**Sources.** [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162)

**Frameworks.** `javascript_node`, `typescript`, `rollup`

**Wrong:**

```json
// tsconfig.json
{ "compilerOptions": { "outDir": "dist", "sourceMap": true } }
```

**Fixed:**

```json
// tsconfig.json
{ "compilerOptions": { "outDir": "dist",
    "sourceMap": true, "inlineSources": true } } // embeds sourcesContent
```

## Webpack devtool clashes with the PostHog plugin

**Problem.** For Vite and Rollup you must enable map output, so the agent does the same for webpack, but the PostHog webpack plugin adds its own SourceMapDevToolPlugin.

**Impact.** Build fails with 'Conflict: Multiple assets emit different content to the same filename index.js.map' and nothing uploads.

**Rule location.** context-mill (main, absent from the older local checkout): context/skills/error-tracking-upload-source-maps/description.md (Vite / Webpack / Rollup examples)

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `webpack`

**Wrong:**

```javascript
module.exports = {
  devtool: 'source-map',
  plugins: [ /* PostHog webpack plugin, sourcemaps.enabled: true */ ]
}
```

**Fixed:**

```javascript
module.exports = {
  devtool: false, // plugin adds its own SourceMapDevToolPlugin
  plugins: [ /* PostHog webpack plugin, sourcemaps.enabled: true */ ]
}
```

## React plus Vite gets the generic CLI path

**Problem.** The agent classifies the app by its UI framework (React), not its bundler. So it hand-rolls posthog-cli instead of using the Vite plugin that generates and injects maps during the real build.

**Impact.** Maps may not be generated or injected to match the real build, so the upload wiring has the wrong shape.

**Rule location.**

- [`wizard: src/programs/error-tracking-upload-source-maps/detect-agentic.ts#VARIANT_PRECEDENCE`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/detect-agentic.ts) (test: \_\_tests\_\_/detect-agentic.test.ts 'ranks bundlers ahead of the generic React variant')
- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Vite / Webpack / Rollup tip)

**Sources.** [PostHog/wizard#689](https://github.com/PostHog/wizard/pull/689)

**Frameworks.** `react`, `vite`, `webpack`, `rollup`

**Wrong:**

```json
// vite.config.ts untouched; package.json:
"build": "vite build && posthog-cli sourcemap process --directory ./dist"
```

**Fixed:**

```ts
// detect-agentic.ts: the detector keeps the EARLIEST matching target
const VARIANT_PRECEDENCE = [
  'react-native', 'flutter', 'android', 'ios',
  'nextjs', 'nuxt', 'angular', 'vite', 'webpack', 'rollup',
  'react', 'node', 'go', 'rust', 'web',
];  // vite/webpack/rollup rank before react
// skill: Vite / Webpack / Rollup: Prefer the bundler plugin from the reference over hand-rolling the CLI
```

## Public project token used to upload maps

**Problem.** The phc\_ token is already in the app, so the agent reuses it for posthog-cli or the bundler plugin. Uploads need a personal API key with specific scopes.

**Impact.** Uploads fail auth (no write scope for symbol sets), so production errors stay minified.

**Rule location.**

- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Get a personal API key, Tips)
- [`wizard: src/programs/error-tracking-upload-source-maps/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/prompt.ts) (STEP 1, wizard\_ask with the 'Source map upload' preset)

**Sources.** [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162), [`context-mill: example-apps/nuxt-4/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-4/README.md)

**Frameworks.** `javascript_node`, `nextjs`, `vite`, `webpack`, `rollup`, `nuxt`, `angular`, `react`

**Wrong:**

```bash
# .env
POSTHOG_CLI_API_KEY=phc_xxxxxxxx   # the public project token from posthog.init
```

**Fixed:**

```bash
# personal API key, "Source map upload" preset
# scopes: organization:read, error_tracking:write
POSTHOG_CLI_API_KEY=phx_xxxxxxxx
POSTHOG_CLI_PROJECT_ID=12345
POSTHOG_CLI_HOST=https://us.posthog.com
```

## Build cannot read uploader credentials. Extra secrets

**Problem.** Rollup and webpack configs do not auto-load .env, and an agent unsure which uploader runs writes several variable sets 'just in case'.

**Impact.** Builds see undefined credentials and skip or fail the upload. Unused live secrets sit in .env.

**Rule location.**

- [`wizard: src/programs/error-tracking-upload-source-maps/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/prompt.ts) (credentialSteps, STEP 4 and STEP 5)
- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Apply build-config changes, Write credentials to the env file: 'Write one set only')

**Sources.** [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475), [PostHog/context-mill#368](https://github.com/PostHog/context-mill/pull/368)

**Frameworks.** `javascript_node`, `rollup`, `webpack`, `vite`

**Wrong:**

```javascript
// rollup.config.js, no dotenv installed
posthog({ personalApiKey: process.env.POSTHOG_API_KEY })   // undefined
# .env also gets a second uploader's variables as a fallback
```

**Fixed:**

```javascript
// STEP 4: install dotenv when the platform does not auto-load .env
import 'dotenv/config'
// STEP 5: write ONE uploader's variable set
// 'a credential nothing reads is an unused secret sitting in the user's env file'
```

## Upload wired for stacks that cannot use it

**Problem.** Asked to set up source maps, the agent wires an upload into any project: one with no PostHog SDK, bare React Native that cannot inject chunk IDs, a project with no build command, or a Rust project a stray JS SDK makes look instrumented.

**Impact.** Maps uploaded for an app that never reports exceptions, uploads that never resolve, or an invented build command that breaks the build. None fails visibly.

**Rule location.**

- [`wizard: src/programs/error-tracking-upload-source-maps/detect-agentic.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/detect-agentic.ts) (classifyProject, rustSdkVerifier, goSdkVerifier)
- detect.ts (SOURCE\_MAPS\_ABORT\_CASES)
- prompt.ts (STEP 6 abort)

**Sources.** [PostHog/wizard#689](https://github.com/PostHog/wizard/pull/689), [PostHog/wizard#941](https://github.com/PostHog/wizard/pull/941), [PostHog/wizard#938](https://github.com/PostHog/wizard/pull/938), [PostHog/wizard#475](https://github.com/PostHog/wizard/pull/475)

**Frameworks.** `all`, `react-native`, `flutter`, `rust`, `go`

**Wrong:**

```text
# no posthog-js/posthog-node dependency: agent still adds posthog-cli upload
# bare React Native (no expo): adds posthog-cli upload to the Metro build
# no build script: agent invents `npm run build`
# Rust workspace: hasPostHog = true because a stray JS SDK exists
```

**Fixed:**

```ts
if (!isAutomatableVariant(p.targetId)) return { instrumentable: false,
  reason: "Source-map upload isn't supported for this stack yet" };
if (p.targetId === 'react-native' && !probes.isExpoProject(p.path)) return { instrumentable: false, reason: BARE_REACT_NATIVE_REASON };
if (!hasPostHog) return { instrumentable: false,
  reason: `No PostHog SDK installed yet — ${install}` };
// prompt STEP 6: no build command -> [ABORT] build command not found
// Rust/Go hasPostHog read from Cargo.toml / go.mod, not the agent
```

## Go SDK detected from any go.mod mention

**Problem.** An agent asked 'does this project use posthog-go?' substring-matches go.mod. A replace, exclude, comment or module line looks like a dependency.

**Impact.** The wizard treats the project as instrumented and wires symbol upload for an app that never reports exceptions.

**Rule location.** [`wizard: src/programs/error-tracking-upload-source-maps/detect-agentic.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/detect-agentic.ts) (goSdkVerifier, goModRequiresSdk)

**Sources.** [PostHog/wizard#1030](https://github.com/PostHog/wizard/pull/1030)

**Frameworks.** `go`

**Wrong:**

```text
module example.com/svc   // fork of github.com/posthog/posthog-go
replace github.com/posthog/posthog-go => ../fork
exclude github.com/posthog/posthog-go v1.21.0
// agent: hasPostHog = true (substring match)
```

**Fixed:**

```typescript
// deterministic go.mod read overrides the agent's hasPostHog boolean
function goModRequiresSdk(content: string): boolean {
  // strip // comments; only `require x` lines and `require ( ... )` blocks count
  if (inBlock === 'require' && code.includes(GO_SDK_MODULE)) return true;
  if (code.startsWith('require ') && code.includes(GO_SDK_MODULE)) return true;
}
```

## Web source-map recipe applied to mobile apps

**Problem.** 'Upload source maps' suggests .js.map files everywhere, but native platforms need their own debug symbols, often through a platform plugin rather than a CLI step.

**Impact.** Wrong artifacts are uploaded and native stack traces stay unresolved.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Android, iOS, React Native, Go, Rust bullets) and config.yaml (android, ios, flutter, go variants)

**Sources.** [PostHog/wizard#941](https://github.com/PostHog/wizard/pull/941), [PostHog/context-mill#263](https://github.com/PostHog/context-mill/pull/263), [PostHog/wizard#938](https://github.com/PostHog/wizard/pull/938)

**Frameworks.** `react-native`, `android`, `ios`, `flutter`, `go`, `rust`

**Wrong:**

```bash
posthog-cli sourcemap upload --directory build/  # *.js.map recipe on an Android app
```

**Fixed:**

```bash
# Android: ProGuard/R8 mappings via the Gradle plugin on the app module
id("com.posthog.android") version "<latest>"   // release needs isMinifyEnabled = true
# iOS: dSYMs via Run Script (upload-symbols.sh with POSTHOG_CLI_DOTENV_FILE)
# React Native (Expo): posthog-react-native/expo plugin, uploadNativeSymbols
# Go/Rust: posthog-cli --dotenv-file .env symbol-sets upload --directory <bin dir>
```

## iOS crashes unsymbolicated: no dSYM upload

**Problem.** Enabling autoCapture looks complete. When asked for symbols the agent hand-rolls a JS-style CLI step and misses the Xcode settings (dSYMs in Release, script sandbox off) and the env prefixes the SDK script needs. The build still succeeds.

**Impact.** Silent: Release builds never upload dSYMs, so crash reports show memory addresses instead of code.

**Rule location.**

- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (iOS (Xcode) bullet, lines ~41-47)
- [`context-mill: context/commandments.yaml#ios`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (autoCapture + dSYM line)
- wizard (main): src/programs/error-tracking-upload-source-maps/detect.ts (VARIANTS\_REQUIRING\_POSTHOG\_CLI) and index.ts (ensurePostHogCli)

**Sources.** [PostHog/context-mill#151](https://github.com/PostHog/context-mill/pull/151), [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162), [PostHog/context-mill#229](https://github.com/PostHog/context-mill/pull/229), [PostHog/wizard#871](https://github.com/PostHog/wizard/pull/871)

**Frameworks.** `ios`, `swift`

**Wrong:**

```bash
config.errorTrackingConfig.autoCapture = true
# hand-rolled Run Script, build settings untouched:
posthog-cli sourcemap process --directory ./build
# DEBUG_INFORMATION_FORMAT = dwarf (Release)
# ENABLE_USER_SCRIPT_SANDBOXING = YES
```

**Fixed:**

```bash
DEBUG_INFORMATION_FORMAT = dwarf-with-dsym   # Release
ENABLE_USER_SCRIPT_SANDBOXING = NO
# Run Script phase, ordered last (SPM variant):
POSTHOG_INCLUDE_SOURCE=1 POSTHOG_CLI_DOTENV_FILE="${SRCROOT}/.env" \
  "${BUILD_DIR%/Build/*}/SourcePackages/checkouts/posthog-ios/build-tools/upload-symbols.sh"
# CocoaPods: "${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh"
# wizard pre-installs posthog-cli (VARIANTS_REQUIRING_POSTHOG_CLI)
```

## iOS errors sent as custom events

**Problem.** The agent copies the custom-event shape still shown in the Swift example app. It never enables errorTrackingConfig.

**Impact.** Nothing appears in Error Tracking, and any crash reports stay unsymbolicated.

**Rule location.** [`context-mill: context/commandments.yaml#ios`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line: 'Enable iOS error autocapture with config.errorTrackingConfig.autoCapture = true and upload dSYM files')

**Sources.** [PostHog/context-mill#151](https://github.com/PostHog/context-mill/pull/151)

**Frameworks.** `swift`, `ios`

**Wrong:**

```swift
PostHogSDK.shared.capture("test_error_triggered", properties: [
    "error_type": "test",
    "error_message": error.localizedDescription,
])
```

**Fixed:**

```swift
config.errorTrackingConfig.autoCapture = true
// and upload dSYM files so crash reports are symbolicated
```

## Android mapping upload never runs

**Problem.** The agent treats Android like web and hand-rolls a posthog-cli step, or applies the Gradle plugin at the root with the SDK's version number. It also misses that the plugin only hooks minified variants.

**Impact.** No ProGuard/R8 mapping is uploaded, so Android stack traces stay obfuscated with no error.

**Rule location.**

- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Android (Gradle) bullet, lines ~48-51)
- wizard (main): src/programs/error-tracking-upload-source-maps/detect.ts (AUTOMATABLE\_VARIANTS, VARIANTS\_REQUIRING\_POSTHOG\_CLI include android)

**Sources.** [PostHog/context-mill#253](https://github.com/PostHog/context-mill/pull/253), [PostHog/wizard#931](https://github.com/PostHog/wizard/pull/931)

**Frameworks.** `android`, `flutter`, `react-native`

**Wrong:**

```kotlin
// build.gradle.kts (root project)
plugins { id("com.posthog.android") version "3.9.0" }  // SDK version reused
android { buildTypes { release {
    isMinifyEnabled = false   // plugin hooks nothing
} } }
```

**Fixed:**

```kotlin
// app/build.gradle.kts (app module, never root)
plugins { id("com.posthog.android") version "<latest plugin>" }  // versioned apart from SDK
android { buildTypes { release {
    isMinifyEnabled = true   // keep existing proguardFiles line
} } }
// no hand-rolled posthog-cli step: the plugin uploads
```

## Rust release build has no symbols

**Problem.** The agent wires symbol upload but keeps the default release profile, which has no debug info. Release profiles often set strip = true too. The upload succeeds either way, so the gap stays hidden.

**Impact.** The uploaded symbol set resolves no frames. macOS makes no .dSYM, and stale uploads never match a new build ID.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Rust (Cargo))

**Sources.** [PostHog/context-mill#262](https://github.com/PostHog/context-mill/pull/262), [PostHog/wizard#938](https://github.com/PostHog/wizard/pull/938)

**Frameworks.** `rust`

**Wrong:**

```toml
# Cargo.toml
[profile.release]
strip = true
# cargo build --release
# posthog-cli symbol-sets upload --directory target/release
```

**Fixed:**

```toml
[profile.release]
debug = "line-tables-only"
split-debuginfo = "packed"   # macOS: produce the .dSYM
strip = "none"               # only if strip was set
# re-upload after every rebuild: each build has its own build ID
# posthog-cli --dotenv-file .env symbol-sets upload --directory target/release
```

## Cargo workspace profile edited in member crate

**Problem.** The agent stays inside the member crate it was pointed at. But Cargo honors \[profile.\*\] only in the workspace root, and it builds into the workspace-level target/.

**Impact.** Debug settings are ignored, the upload points at an empty member target dir, and .env lands in the wrong place.

**Rule location.**

- [`wizard: src/programs/error-tracking-upload-source-maps/prompt.ts`](https://github.com/PostHog/wizard/blob/main/src/programs/error-tracking-upload-source-maps/prompt.ts) (Cargo workspace exception)
- `context-mill: error-tracking-upload-source-maps/description.md`

**Sources.** [PostHog/wizard#938](https://github.com/PostHog/wizard/pull/938), [PostHog/context-mill#262](https://github.com/PostHog/context-mill/pull/262)

**Frameworks.** `rust`

**Wrong:**

```toml
# crates/api/Cargo.toml   (member)
[profile.release]
debug = "line-tables-only"   # ignored outside the workspace root
# posthog-cli symbol-sets upload --directory crates/api/target/release
```

**Fixed:**

```toml
# root manifest: cargo locate-project --workspace --message-format plain
[profile.release]
debug = "line-tables-only"
# workspace-level target/, .env next to the root manifest (in scope)
# posthog-cli --dotenv-file .env symbol-sets upload --directory target/release
```

## React Native native crash symbols skipped

**Problem.** The reference docs badge native symbolication as optional, so the agent wires only JS/Hermes maps. It also misses that native crash capture must be turned on at runtime, and it burns time trying to make bare React Native work.

**Impact.** Native crashes arrive unsymbolicated or are never captured at all. Bare RN attempts made wizard runs extremely slow.

**Rule location.**

- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (React Native (Expo) bullet, lines ~64-67 and ~87)
- wizard (main): src/programs/error-tracking-upload-source-maps/detect-agentic.ts (BARE\_REACT\_NATIVE\_REASON)

**Sources.** [PostHog/context-mill#263](https://github.com/PostHog/context-mill/pull/263), [PostHog/wizard#941](https://github.com/PostHog/wizard/pull/941)

**Frameworks.** `react-native`, `expo`

**Wrong:**

```text
// app.json
"plugins": [["posthog-react-native/expo", {}]]
// metro.config.js: default config
// SDK init: nativeCrashes not enabled
```

**Fixed:**

```text
app.json: ["posthog-react-native/expo", { "uploadNativeSymbols": true, "dotenvFile": ".env" }]
  (dotenvFile needs posthog-react-native >= 4.60.0)
metro.config.js: getPostHogExpoConfig from posthog-react-native/metro
SDK init: errorTracking.autocapture.nativeCrashes on + @posthog/react-native-plugin installed
no Expo -> not supported: 'Bare React Native (without Expo) is not supported'
```

## Flutter symbols uploaded for one platform only

**Problem.** Flutter looks like one codebase, so the agent wires one upload or looks for a Dart-level step. But each of the three compilers makes its own artifact, and captureNativeExceptions defaults to false.

**Impact.** Stack traces from the platforms left out stay unsymbolicated, and native SDK crashes are not captured.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Flutter bullets, lines ~68-73 and ~88-91)

**Sources.** [PostHog/context-mill#281](https://github.com/PostHog/context-mill/pull/281), [PostHog/wizard#985](https://github.com/PostHog/wizard/pull/985)

**Frameworks.** `flutter`

**Wrong:**

```shell
# only web wired
flutter build web --source-maps
posthog-cli sourcemap process --directory build/web
# android/ and ios/ have no upload step
```

**Fixed:**

```shell
# one upload path per platform directory present
web:     flutter build web --source-maps && posthog-cli --dotenv-file .env sourcemap process --directory build/web
android: Gradle plugin on android/app/build.gradle.kts; .env via rootProject.file("../.env")
ios:     Runner Run Script ${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh
         with POSTHOG_CLI_DOTENV_FILE="${SRCROOT}/../.env"
# errorTrackingConfig.captureNativeExceptions = true
```

## Flutter exceptions captured without stack trace

**Problem.** captureException takes named arguments, and stackTrace is optional. So passing only the error compiles fine. Uncaught-error capture also needs its own errorTrackingConfig flags.

**Impact.** Events arrive with no frames to resolve, and uncaught Flutter or platform errors are never captured.

**Rule location.**

- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Flutter test-flow bullet, line ~360: arguments are named, stackTrace required)
- [`context-mill: example-apps/flutter/lib/posthog/posthog.dart`](https://github.com/PostHog/context-mill/blob/main/example-apps/flutter/lib/posthog/posthog.dart) (errorTrackingConfig lines 65-68), example-apps/flutter/lib/screens/profile\_screen.dart (lines 18-26)

**Sources.** [PostHog/context-mill#276](https://github.com/PostHog/context-mill/pull/276), [PostHog/context-mill#281](https://github.com/PostHog/context-mill/pull/281)

**Frameworks.** `flutter`

**Wrong:**

```dart
} catch (error) {
  await Posthog().captureException(error: error);
}
// no errorTrackingConfig: uncaught errors not captured
```

**Fixed:**

```dart
config.errorTrackingConfig.captureFlutterErrors = true;
config.errorTrackingConfig.capturePlatformDispatcherErrors = true;
config.errorTrackingConfig.inAppIncludes.add('package:burrito_app');
// handled:
} catch (error, stackTrace) {
  await Posthog().captureException(error: error, stackTrace: stackTrace);
}
```

## Go binary built without build ID

**Problem.** A plain `go build` looks correct. On Linux it emits no GNU build ID unless asked, and on macOS the default compressed DWARF cannot be symbolicated.

**Impact.** The SDK cannot identify the running binary, so frames stay runtime-resolved and the uploaded symbols never match.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Go gotchas 1-2)

**Sources.** [PostHog/context-mill#299](https://github.com/PostHog/context-mill/pull/299)

**Frameworks.** `go`

**Wrong:**

```shell
go build -o bin/app .
posthog-cli symbol-sets upload --directory ./bin
```

**Fixed:**

```shell
# Linux: emit a GNU build ID (needed at runtime and upload time)
go build -ldflags="-B gobuildid" -o bin/<app> .
# macOS: symbolication cannot read compressed DWARF
go build -ldflags="-compressdwarf=false" -o bin/<app> .
```

## Go release flags strip symbols before upload

**Problem.** `-s -w` and `-trimpath` are standard Go release-size advice. They delete exactly what symbol upload needs.

**Impact.** There is no DWARF left to upload, and --include-source cannot find the rewritten source paths.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Go gotcha 3)

**Sources.** [PostHog/context-mill#299](https://github.com/PostHog/context-mill/pull/299)

**Frameworks.** `go`

**Wrong:**

```shell
go build -ldflags="-s -w" -trimpath -o bin/app .
posthog-cli symbol-sets upload --directory ./bin --include-source
```

**Fixed:**

```shell
go build -ldflags="-B gobuildid" -o bin/<app> .
posthog-cli --dotenv-file .env symbol-sets upload --directory ./bin --include-source
# never -ldflags "-s" / "-w"; avoid -trimpath
```

## Go symbols uploaded for an old SDK

**Problem.** The agent wires the upload and leaves the existing posthog-go pin alone. Nothing fails when an older SDK never sends the addresses that symbolication needs.

**Impact.** posthog-go below 1.22.0 sends no instruction addresses or $debug\_images, so uploaded symbols are never used.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Go gotcha 4)

**Sources.** [PostHog/context-mill#299](https://github.com/PostHog/context-mill/pull/299), [PostHog/wizard#1030](https://github.com/PostHog/wizard/pull/1030)

**Frameworks.** `go`

**Wrong:**

```text
// go.mod
require github.com/posthog/posthog-go v1.21.0
// upload wired, SDK left as is
posthog-cli --dotenv-file .env symbol-sets upload --directory ./bin
```

**Fixed:**

```text
Requires posthog-go 1.22.0+. If go.mod pins older, upgrade in this step:
  go get github.com/posthog/posthog-go@latest && go mod tidy
(the skill agent fixes it; the wizard does not gate on version)
```

## Docker build loses the release's git commit

**Problem.** The agent forwards upload credentials into the Docker build. It does not know the CLI reads git metadata from env vars or .git, and a docker build sees neither. ARG alone is also not visible to the CLI.

**Impact.** Error Tracking releases link to no commit, branch or repo, and no error is raised.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Associate the release with a git commit)

**Sources.** [PostHog/context-mill#194](https://github.com/PostHog/context-mill/pull/194)

**Frameworks.** `docker`, `github-actions`, `javascript-node`

**Wrong:**

```yaml
build-args: |
  POSTHOG_CLI_API_KEY=${{ secrets.POSTHOG_CLI_API_KEY }}
# no GITHUB_SHA / GITHUB_REF_NAME; docker build sees neither env nor .git
```

**Fixed:**

```yaml
build-args: |
  GITHUB_ACTIONS=true
  GITHUB_SHA=${{ github.sha }}
  GITHUB_REF_NAME=${{ github.ref_name }}
  GITHUB_REPOSITORY=${{ github.repository }}
# Dockerfile: ARG each, then ENV each
```

## Readable-stack apps get no release linking

**Problem.** Python, Ruby and PHP stack traces are already readable, so the agent and the old flow skipped the whole upload step. Release tagging was part of that step, so it went too.

**Impact.** Silent: exceptions carry no $release\_id, so Error Tracking cannot say which deploy or commit caused an error.

**Rule location.**

- [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) ("Resolve the release in CI" examples)
- [`context-mill: context/agents/error-tracking/link-releases.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/link-releases.md)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416), [PostHog/wizard#1399](https://github.com/PostHog/wizard/pull/1399), [PostHog/wizard-workbench#4266](https://github.com/PostHog/wizard-workbench/pull/4266)

**Frameworks.** `python`, `django`, `flask`, `ruby`, `rails`, `sinatra`, `php`, `laravel`

**Wrong:**

```python
# plain Flask app: capture only
posthog = Posthog(os.environ["POSTHOG_API_KEY"], host=os.environ["POSTHOG_HOST"])
posthog.capture_exception(exc)   # no release resolved at deploy
```

**Fixed:**

```yaml
- id: posthog-release
  uses: PostHog/resolve-release@v1     # production deploy job only
  with:
    api-key: ${{ secrets.POSTHOG_CLI_API_KEY }}
    project-id: ${{ vars.POSTHOG_PROJECT_ID }}
# app starts with POSTHOG_RELEASE_ID=${{ steps.posthog-release.outputs.release-id }}
```

## Backend release name differs from source maps

**Problem.** Setting a friendly release-name looks harmless. But the source map upload in the same repo uses repo name plus commit SHA, so the two steps create two releases.

**Impact.** Frontend and backend errors from one deploy land on different releases, and nothing reports the split.

**Rule location.** [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) (Tips under "find the production deploy job", third bullet)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416), [`resolve-release: action.yml`](https://github.com/PostHog/resolve-release/blob/HEAD/action.yml)

**Frameworks.** `python`, `django`, `node`, `vite`

**Wrong:**

```yaml
- uses: PostHog/resolve-release@v1
  with:
    api-key: ${{ secrets.POSTHOG_CLI_API_KEY }}
    project-id: ${{ vars.POSTHOG_PROJECT_ID }}
    release-name: my-service   # upload uses repo name + SHA
```

**Fixed:**

```yaml
- uses: PostHog/resolve-release@v1
  with:
    api-key: ${{ secrets.POSTHOG_CLI_API_KEY }}
    project-id: ${{ vars.POSTHOG_PROJECT_ID }}
    # keep defaults; set release-name/release-version only to match
    # custom values the source map upload already sets
```

## CLI catch-all swallows errors before autocapture

**Problem.** Autocapture only sees unhandled exceptions, but CLI scripts wrap main() in a catch-all that prints and exits, so turning autocapture on reports nothing.

**Impact.** Silent: script failures never reach Error Tracking. A capture with no distinct id becomes a personless random-id event.

**Rule location.**

- [`context-mill: example-apps/python/todo.py#main`](https://github.com/PostHog/context-mill/blob/main/example-apps/python/todo.py) (note: example still passes get\_user\_id() positionally, which fails on current posthog-python)
- [`context-mill: example-apps/php/todo.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/php/todo.php) (PostHog::captureException($e, getUserId(), ...))

**Sources.** [PostHog/context-mill#136](https://github.com/PostHog/context-mill/pull/136)

**Frameworks.** `python`, `php`

**Wrong:**

```python
posthog = Posthog(token, enable_exception_autocapture=True)
try:
    main()
except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(1)   # swallowed: nothing is captured
```

**Fixed:**

```python
except Exception as e:
    print(f"ERROR: {e}")
    # Manually capture handled errors
    if posthog:
        posthog.capture_exception(e, distinct_id=get_user_id())
    sys.exit(1)
```

## PHP autocaptured errors are personless

**Problem.** The PHP README snippet enables error\_tracking without a context\_provider, so the agent copies it exactly and nothing looks wrong.

**Impact.** Silent: autocaptured exceptions get a random UUID and $process\_person\_profile=false, so they cannot be tied to a user.

**Rule location.** [`context-mill: example-apps/php/todo.php`](https://github.com/PostHog/context-mill/blob/main/example-apps/php/todo.php) (PostHog::init options, error\_tracking.context\_provider)

**Sources.** [PostHog/context-mill#136](https://github.com/PostHog/context-mill/pull/136), [`posthog-php: lib/ExceptionCapture.php`](https://github.com/PostHog/posthog-php/blob/HEAD/lib/ExceptionCapture.php)

**Frameworks.** `php`, `laravel`

**Wrong:**

```php
PostHog::init($projectToken, [
    'error_tracking' => ['enabled' => true],
]);
```

**Fixed:**

```php
'error_tracking' => [
    'enabled' => true,
    'context_provider' => static function (array $payload): array {
        return [
            'distinctId' => getUserId(),
            'properties' => ['app' => 'php_todo_cli'],
        ];
    },
],
```

## .NET assumed to autocapture exceptions

**Problem.** Python and Node SDKs autocapture, so the agent assumes .NET does too and wires nothing. The .NET SDK has no automatic capture yet.

**Impact.** Silent: Error Tracking stays empty although the integration looks complete.

**Rule location.** [`context-mill: context/commandments.yaml#dotnet`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#145](https://github.com/PostHog/context-mill/pull/145)

**Frameworks.** `dotnet`, `aspnetcore`

**Wrong:**

```csharp
catch (Exception ex)
{
    logger.LogError(ex, "failed"); // assumes the SDK autocaptures
}
```

**Fixed:**

```csharp
catch (Exception ex)
{
    // automatic exception capture is not available in the .NET SDK yet
    posthog.CaptureException(ex, distinctId, properties, groups, flags);
}
```

## WordPress recovery mode swallows fatals first

**Problem.** Enabling error\_tracking or a PHP set\_exception\_handler looks universal, but WordPress's WP\_Fatal\_Error\_Handler renders the recovery page first, and WP\_DEBUG is off in production.

**Impact.** Silent: fatals can be swallowed before PostHog sees them in production.

**Rule location.** [`context-mill: context/commandments.yaml#wordpress`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (the WP\_Fatal\_Error\_Handler bullet)

**Sources.** [PostHog/context-mill#279](https://github.com/PostHog/context-mill/pull/279), [context-mill@e55d165](https://github.com/PostHog/context-mill/commit/e55d165d)

**Frameworks.** `wordpress`, `php`

**Wrong:**

```php
PostHog::init($token, ['error_tracking' => ['enabled' => true]]);
set_exception_handler(function ($e) {
    PostHog::captureException($e);
}); // WP_Fatal_Error_Handler renders recovery mode first
// relies on WP_DEBUG=true to surface errors
```

**Fixed:**

```php
try {
    run_checkout_sync();
} catch (\Throwable $e) {
    PostHog::captureException($e); // explicit capture
    throw $e;
}
// do not rely on WP_DEBUG being on in production
```

## Rails rescued errors and job failures missed

**Problem.** Default config only sees unhandled controller errors. Rescue\_from and ActiveJob failures are 'handled' from the SDK's view, and the options that report them are off.

**Impact.** Silent: the most common Rails failures leave Error Tracking empty.

**Rule location.**

- [`context-mill: context/commandments.yaml#ruby-on-rails`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)
- [`context-mill: example-apps/ruby-on-rails/config/initializers/posthog.rb`](https://github.com/PostHog/context-mill/blob/main/example-apps/ruby-on-rails/config/initializers/posthog.rb)

**Sources.** [PostHog/context-mill#85](https://github.com/PostHog/context-mill/pull/85), [PostHog/context-mill#138](https://github.com/PostHog/context-mill/pull/138)

**Frameworks.** `ruby-on-rails`

**Wrong:**

```ruby
PostHog.init do |config|
  config.api_key = ENV['POSTHOG_PROJECT_TOKEN']
end
# rescue_from StandardError renders a 500; job errors never reported
```

**Fixed:**

```ruby
PostHog::Rails.configure do |config|
  config.auto_capture_exceptions = true
  config.report_rescued_exceptions = true  # rescue_from
  config.auto_instrument_active_job = true # job class, queue, args
end
```

## Elixir errors poorly grouped, no release source

**Problem.** Default Logger capture works out of the box, so the agent skips in\_app\_otp\_apps and the extra mix task that packages source for releases.

**Impact.** Silent: poor grouping and no source context in release builds.

**Rule location.** [`context-mill: context/commandments.yaml#elixir`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#154](https://github.com/PostHog/context-mill/pull/154)

**Frameworks.** `elixir`

**Wrong:**

```elixir
config :posthog, api_host: host, api_key: key
# release built with plain `mix release`
```

**Fixed:**

```elixir
config :posthog, api_host: host, api_key: key,
  in_app_otp_apps: [:my_app]
# enable source code context, then before releasing:
# mix posthog.package_source_code
```

## React Router error boundary swallows exceptions

**Problem.** The agent trusts capture\_exceptions to see every error. But the router's ErrorBoundary catches render errors before window.onerror does.

**Impact.** Silent: render errors vanish from Error Tracking even with capture\_exceptions on.

**Rule location.**

- [`context-mill: example-apps/react-react-router-7-framework/app/root.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-7-framework/app/root.tsx) (ErrorBoundary), react-react-router-7-data/app/root.tsx (RootErrorBoundary), react-react-router-7-declarative/src/main.tsx (PostHogErrorBoundary)
- generic rule in context/skills/integration-v2/error-tracking-step/description.md (global error boundary)

**Sources.** [PostHog/wizard-workbench#4049](https://github.com/PostHog/wizard-workbench/pull/4049), [PostHog/wizard-workbench#4302](https://github.com/PostHog/wizard-workbench/pull/4302), [PostHog/wizard-workbench#4364](https://github.com/PostHog/wizard-workbench/pull/4364), [PostHog/wizard-workbench#4468](https://github.com/PostHog/wizard-workbench/pull/4468), [PostHog/context-mill#101](https://github.com/PostHog/context-mill/pull/101), [context-mill@933a28c](https://github.com/PostHog/context-mill/commit/933a28c3)

**Frameworks.** `react-router-7-framework`, `react-router-7-data`, `react-router-7-declarative`, `tanstack-router`

**Wrong:**

```ts
posthog.init(token, { api_host: host, capture_exceptions: true })
// root.tsx ErrorBoundary renders UI only, no captureException
```

**Fixed:**

```tsx
// data mode: root.tsx (framework mode takes { error } as a prop instead)
export function RootErrorBoundary() {
  const error = useRouteError();
  const posthog = usePostHog();
  if (error) posthog.captureException(error);
  ...
}
// declarative: <PostHogProvider client={posthog}><PostHogErrorBoundary><BrowserRouter>
```

## Vue component errors never reach PostHog

**Problem.** The agent relies on window.onerror autocapture. Vue handles component errors itself and, in production, only logs them unless app.config.errorHandler is set.

**Impact.** Silent: component and handler errors never appear in Error Tracking.

**Rule location.** [`context-mill: example-apps/vue-3/src/main.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/vue-3/src/main.ts) and example-apps/vue-3/README.md (global errorHandler)

**Sources.** [PostHog/context-mill#66](https://github.com/PostHog/context-mill/pull/66)

**Frameworks.** `vue`

**Wrong:**

```typescript
posthog.init(token, { api_host: host, capture_exceptions: true })
app.mount('#app')   // no app.config.errorHandler
```

**Fixed:**

```typescript
posthog.init(import.meta.env.VITE_POSTHOG_PROJECT_TOKEN || '', {
  api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
  defaults: '2026-01-30',
})
app.config.errorHandler = (err, instance, info) => {
  posthog.captureException(err)
}
app.mount('#app')
```

## Nuxt component errors bypass autocapture

**Problem.** As in plain Vue, component errors never reach window.onerror. In Nuxt the fix is the vue:error app hook, not app.config.

**Impact.** Silent: many component errors never appear in Error Tracking.

**Rule location.** [`context-mill: example-apps/nuxt-3-6/plugins/posthog.client.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-3-6/plugins/posthog.client.ts) and README

**Sources.** [PostHog/context-mill#64](https://github.com/PostHog/context-mill/pull/64)

**Frameworks.** `nuxt-3-6`

**Wrong:**

```ts
posthog.init(publicKey, { api_host: host, capture_exceptions: true })
// no Vue-level hook; component errors swallowed by Vue
```

**Fixed:**

```ts
// plugins/posthog.client.ts
nuxtApp.hook('vue:error', (error) => {
  posthogClient.captureException(error)
})
```

## SvelteKit handleError hooks not wired

**Problem.** The agent assumes capture\_exceptions in hooks.client.ts covers everything. SvelteKit sends handled and server errors through handleError hooks instead.

**Impact.** Silent: server errors and framework-handled errors never reach Error Tracking.

**Rule location.**

- [`context-mill: example-apps/sveltekit/src/hooks.client.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/sveltekit/src/hooks.client.ts) and hooks.server.ts
- [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (sveltekit, line ~238, flush in handleError)

**Sources.** [PostHog/wizard-workbench#4472](https://github.com/PostHog/wizard-workbench/pull/4472)

**Frameworks.** `sveltekit`

**Wrong:**

```ts
// hooks.client.ts: posthog.init(..., { capture_exceptions: true }) only
// hooks.server.ts: no handleError export
```

**Fixed:**

```ts
// hooks.client.ts
export const handleError: HandleClientError = async ({ error, status, message }) => {
  posthog.captureException(error);
  return { message, status };
};
// hooks.server.ts: HandleServerError, posthog-node getPostHogClient()
//   posthog.capture({ distinctId, event: 'server_error', properties })
//   await posthog.flush()  // short-lived request
```

## Exception step fed the SDK install page

**Problem.** Reusing the integration's per-SDK docs matrix seems efficient, but library install pages say nothing about panic hooks, log handlers or framework error boundaries.

**Impact.** Exceptions are not captured on platforms whose setup lives only on the error-tracking page.

**Rule location.** [`context-mill: context/skills/integration-v2/error-tracking-step/config.yaml`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/error-tracking-step/config.yaml)

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `all`

**Wrong:**

```yaml
variants_from: integration   # docs_urls -> libraries/<sdk>.md
```

**Fixed:**

```yaml
variants:
- id: nextjs-app-router
  docs_urls:
  - https://posthog.com/docs/error-tracking/installation/nextjs.md
# 40 variants, each with its own exception-capture page
```

## Flutter native exception capture left off

**Problem.** The agent wires dSYM and Gradle symbol uploads and assumes native crashes are captured. captureNativeExceptions defaults to false, and nothing warns about it.

**Impact.** Silent: the native SDKs capture nothing, so the uploaded symbols are never used.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (Flutter bullet, captureNativeExceptions)

**Sources.** [PostHog/context-mill#281](https://github.com/PostHog/context-mill/pull/281)

**Frameworks.** `flutter`

**Wrong:**

```dart
final config = PostHogConfig('phc_...');
// dSYM / Gradle uploads wired, native capture left at default (false)
await Posthog().setup(config);
```

**Fixed:**

```dart
final config = PostHogConfig('phc_...');
config.errorTrackingConfig.captureNativeExceptions = true; // defaults to false
await Posthog().setup(config);
```

## Bare sourcemap inject passes only on dev machines

**Problem.** The docs pass --dotenv-file only to upload and show a bare `inject`, so the agent assumes inject only edits local files. Leftover ~/.posthog credentials from an old login hide the failure locally.

**Impact.** The build works on the developer's machine, then fails in CI or on a teammate's machine.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md#Make`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) credentials available at build time

**Sources.** [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183), [PostHog/wizard#651](https://github.com/PostHog/wizard/pull/651)

**Frameworks.** `node`, `vite`, `webpack`, `rollup`

**Wrong:**

```json
"build": "tsc && posthog-cli sourcemap inject --directory ./dist && posthog-cli --dotenv-file .env sourcemap upload --directory ./dist --release-name my-app"
```

**Fixed:**

```json
"build": "tsc && posthog-cli --dotenv-file .env sourcemap process --directory ./dist --release-name my-app"
```

## Upload CLI pointed at the ingestion host

**Problem.** The agent reuses the SDK host it already wrote. posthog-cli needs the API host, not \*.i.posthog.com, and nothing in the SDK setup says so.

**Impact.** Source map or symbol uploads hit the ingestion endpoint, so they fail authentication or get rejected, and stack traces stay unsymbolicated.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) (iOS / Xcode bullet in 'Make credentials available at build time' Tips states it, Android, React Native, Go/Rust bullets refer back to it)

**Sources.** [PostHog/context-mill#229](https://github.com/PostHog/context-mill/pull/229), [PostHog/context-mill#253](https://github.com/PostHog/context-mill/pull/253), [PostHog/context-mill#262](https://github.com/PostHog/context-mill/pull/262), [PostHog/context-mill#263](https://github.com/PostHog/context-mill/pull/263)

**Frameworks.** `ios`, `android`, `react-native`, `rust`, `go`, `flutter`, `posthog-cli`

**Wrong:**

```shell
POSTHOG_CLI_HOST=https://us.i.posthog.com
POSTHOG_CLI_PROJECT_ID=12345
POSTHOG_CLI_API_KEY=phx_...
```

**Fixed:**

```shell
# .env (gitignored)
POSTHOG_CLI_HOST=https://us.posthog.com   # API host; EU: https://eu.posthog.com
# never the *.i.posthog.com ingestion host
POSTHOG_CLI_PROJECT_ID=12345
POSTHOG_CLI_API_KEY=phx_...
```

## Release step omits host for EU projects

**Problem.** The resolve-release action works with no host because it defaults to US Cloud. An agent copying the minimal example never adds the host field for EU or self-hosted projects.

**Impact.** The resolve call goes to the wrong instance, so the release is never created where the project lives.

**Rule location.** [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) (Resolve the release in CI, Tips)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `all`, `github-actions`

**Wrong:**

```yaml
- uses: PostHog/resolve-release@v1
  with:
    api-key: ${{ secrets.POSTHOG_CLI_API_KEY }}
    project-id: ${{ vars.POSTHOG_PROJECT_ID }}   # EU project, no host
```

**Fixed:**

```yaml
- uses: PostHog/resolve-release@v1
  with:
    api-key: ${{ secrets.POSTHOG_CLI_API_KEY }}
    project-id: ${{ vars.POSTHOG_PROJECT_ID }}
    host: https://eu.posthog.com   # app URL from project context
# CLI form: POSTHOG_CLI_HOST
```

## Init fails typecheck on env lookups

**Problem.** The agent adds an env guard but checks a different expression than the one it passes. It also drops the example's `!` or `?? ''`, so strict TypeScript sees `string | undefined`.

**Impact.** The build fails typecheck, emits no bundle and uploads no source maps. If the upload ran first, maps land but the build still exits non-zero.

**Rule location.**

- [`context-mill: context/agents/error-tracking/init.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/init.md) ("The init has to type-check")
- configure.md

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `TypeScript`, `checkJs JavaScript`

**Wrong:**

```ts
const missing = process.env.POSTHOG_KEY ? null : 'POSTHOG_KEY'
if (missing) { console.warn(missing) }
new PostHog(process.env.POSTHOG_KEY, opts) // string | undefined
```

**Fixed:**

```ts
const key = process.env.POSTHOG_KEY
if (!key) { /* guard */ } else { new PostHog(key, opts) } // narrowed to string
// keep an existing `process.env.KEY ?? ''` or `!` from the plugin example
```

## esbuild CommonJS bundle in an ESM package

**Problem.** `esbuild --platform=node` emits CommonJS by default. The agent is not allowed to run the bundle, so it never sees the crash at boot.

**Impact.** The bundle dies at boot with ReferenceError: module is not defined in ES module scope.

**Rule location.** [`context-mill: context/agents/error-tracking/configure.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/configure.md) (module format must match package type)

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `Node`, `esbuild`

**Wrong:**

```bash
# package.json: "type": "module"
esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js
```

**Fixed:**

```bash
# read package.json "type" first; ESM package:
esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js
```

## Build emits bundle but start runs source

**Problem.** To get source maps the agent adds a bundling step. It never checks what the start script actually executes, and the mismatch causes no error.

**Impact.** Silent: uploaded source maps never match the code that runs, so every map goes unused.

**Rule location.** [`context-mill: context/agents/error-tracking/configure.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/configure.md)

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393)

**Frameworks.** `Node`, `esbuild`, `tsc`

**Wrong:**

```json
"build": "esbuild src/index.ts --bundle --outdir=dist --sourcemap",
"start": "node src/index.js"
```

**Fixed:**

```json
"build": "esbuild src/index.ts --bundle --outdir=dist --sourcemap",
"start": "node dist/index.js"
```

## Source map upload breaks builds without keys

**Problem.** The docs snippet turns uploads on unconditionally, so the agent copies it. Local and preview builds have no upload keys.

**Impact.** Builds fail with "projectId is required" anywhere the keys are not set.

**Rule location.** `context-mill: error-tracking` skills

**Sources.** [PostHog/context-mill#424](https://github.com/PostHog/context-mill/pull/424)

**Frameworks.** `javascript`

**Wrong:**

```js
sourcemaps: { enabled: true }
```

**Fixed:**

```js
sourcemaps: { enabled: !!process.env.POSTHOG_API_KEY }
```

## Source maps shipped publicly or bundles not injected

**Problem.** Generating maps and deploying dist/ looks done. Whether the deployed bundle has the injected chunk ID, and whether the .map files are public, never shows up as an error.

**Impact.** Source code is exposed publicly, or stack traces never match the uploaded maps (silent).

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) ("Tips" list: 'Inject before deploy', 'Wire injection + upload into the build itself', 'Don't ship source maps publicly', later 'Uploaded maps live in PostHog and never need to be served publicly')

**Sources.** [PostHog/context-mill#162](https://github.com/PostHog/context-mill/pull/162)

**Frameworks.** `Web`, `Node.js`, `Vite`, `Webpack`, `Rollup`

**Wrong:**

```text
deploy dist/**   # includes *.js.map
# posthog-cli sourcemap process skipped, or run on a different build
```

**Fixed:**

```shell
# inject + upload inside the same production build; deploy the injected bundles
tsc && posthog-cli sourcemap process --directory ./dist
# (bundler plugins for Vite/Webpack/Rollup do inject + upload in one pass)
# omit .map files from the deployed artifact (or use hidden source maps)
```

## Elixir release built without packaged source

**Problem.** Turning on error tracking in config looks complete. Releases also need a separate packaging step, and nothing fails without it.

**Impact.** Exceptions from releases arrive without source context, so stack frames show no code, and nothing reports it.

**Rule location.** [`context-mill: context/commandments.yaml#elixir`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml)

**Sources.** [PostHog/context-mill#154](https://github.com/PostHog/context-mill/pull/154)

**Frameworks.** `elixir`

**Wrong:**

```shell
MIX_ENV=prod mix release
```

**Fixed:**

```shell
# with source code context enabled in config
mix posthog.package_source_code
MIX_ENV=prod mix release
```

## Upload secrets never reach the Docker build

**Problem.** Setting secrets as job env looks enough. But env does not cross into a Docker build, an SSH session or a nested action, and the upload fails without a trace.

**Impact.** Silent: source maps never upload on deploy, because the build step has no credentials.

**Rule location.** [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) ("Set up CI for automatic uploads": intro sentence on the three boundaries, Dockerfile build stage / single-stage BuildKit secret examples, 'GitHub Actions, docker build / docker/build-push-action')

**Sources.** [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183), [PostHog/wizard-workbench#1855](https://github.com/PostHog/wizard-workbench/pull/1855)

**Frameworks.** `javascript-node`, `docker`, `github-actions`, `gitlab-ci`

**Wrong:**

```yaml
- uses: docker/build-push-action@v6
  env:
    POSTHOG_CLI_API_KEY: ${{ secrets.POSTHOG_CLI_API_KEY }}
  with: { context: ., push: true }
# Dockerfile: RUN npm run build   (no ARG/ENV, key never arrives)
```

**Fixed:**

```yaml
build-args: |
  POSTHOG_CLI_API_KEY=${{ secrets.POSTHOG_CLI_API_KEY }}
  POSTHOG_CLI_PROJECT_ID=${{ secrets.POSTHOG_CLI_PROJECT_ID }}
  POSTHOG_CLI_HOST=${{ secrets.POSTHOG_CLI_HOST }}
# Dockerfile build stage (multi-stage; single-stage uses a BuildKit secret for the key):
# ARG POSTHOG_CLI_API_KEY
# ENV POSTHOG_CLI_API_KEY=$POSTHOG_CLI_API_KEY
```

## Docker build has no release name or version

**Problem.** The agent forwards only the upload credentials and assumes the CLI can read the release from git. Inside a container build, .git is usually in .dockerignore and the CI variables are gone.

**Impact.** The uploader has only half an identity and stops the build.

**Rule location.**

- [`context-mill: context/agents/error-tracking/wire-ci.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/wire-ci.md) ("Two things cross the boundary, not one")
- [`context-mill: context/skills/error-tracking-upload-source-maps/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-upload-source-maps/description.md) ("Associate the release with a git commit")

**Sources.** [PostHog/context-mill#393](https://github.com/PostHog/context-mill/pull/393), [PostHog/context-mill#183](https://github.com/PostHog/context-mill/pull/183)

**Frameworks.** `Docker`, `GitHub Actions`, `GitLab CI`

**Wrong:**

```dockerfile
# Dockerfile
ARG POSTHOG_CLI_PROJECT_ID
RUN posthog-cli sourcemap process --directory ./dist
# .git is in .dockerignore; CI git vars stop at `docker build`
```

**Fixed:**

```dockerfile
# forward the provider's git vars as build args (GitHub shown),
# and declare each as ARG and ENV: ARG alone is invisible to the uploader
ARG GITHUB_SHA
ENV GITHUB_SHA=$GITHUB_SHA
ARG GITHUB_REPOSITORY
ENV GITHUB_REPOSITORY=$GITHUB_REPOSITORY
# no pipeline (hand-built image): supply BOTH name and version
# from a build arg or the manifest
```

## Release ID never reaches the running container

**Problem.** Setting POSTHOG\_RELEASE\_ID in CI or in a build stage looks correct in the diff. Multi-stage Docker drops it at the final stage, and the deploy stays green.

**Impact.** Silent: the running app has no POSTHOG\_RELEASE\_ID, so every exception arrives without a release.

**Rule location.**

- [`context-mill: context/agents/error-tracking/link-releases.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/link-releases.md) ("The last hop decides it")
- [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) (Give the release ID to the running app > Tips: Docker final stage)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `python`, `flask`, `django`, `docker`, `ruby`, `php`

**Wrong:**

```dockerfile
FROM python:3.12 AS build
ARG POSTHOG_RELEASE_ID
# build stage only: the final stage below never sees it
ENV POSTHOG_RELEASE_ID=$POSTHOG_RELEASE_ID

FROM python:3.12-slim
COPY --from=build /app /app
CMD ["gunicorn", "app:app"]
```

**Fixed:**

```dockerfile
FROM python:3.12-slim
# final (runtime) stage: the running container reads it
ARG POSTHOG_RELEASE_ID
ENV POSTHOG_RELEASE_ID=$POSTHOG_RELEASE_ID
COPY --from=build /app /app
CMD ["gunicorn", "app:app"]
# workflow: build-args: POSTHOG_RELEASE_ID=${{ steps.posthog-release.outputs.release-id }}
# docker run / compose: -e POSTHOG_RELEASE_ID=...
```

## SSH export never reaches the systemd service

**Problem.** Exporting the variable in the deploy script feels like setting it for the app. A systemd or supervisord service has its own environment, which is read again only on restart.

**Impact.** The SDK reads the ID once, when the client is created, so it sends no release. Nothing reports it.

**Rule location.** [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) (SSH deploy that restarts a service)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `ruby`, `sinatra`, `rails`, `python`, `systemd`

**Wrong:**

```yaml
script: |
  export POSTHOG_RELEASE_ID=${{ steps.posthog-release.outputs.release-id }}
  sudo systemctl restart app     # service env is not the SSH session env
```

**Fixed:**

```yaml
script: |
  sudo sed -i '/^POSTHOG_RELEASE_ID=/d' /etc/app/app.env      # replace, never append
  echo "POSTHOG_RELEASE_ID=$ID" | sudo tee -a /etc/app/app.env
  sudo systemctl restart app   # EnvironmentFile= re-read on restart, not reload
```

## PHP-FPM clear\_env drops the release ID

**Problem.** Setting the variable in the container env works for CLI PHP. When the repo ships its own FPM pool config, `clear_env` is yes or unset (FPM's default is yes) and strips the variable from the workers that serve requests. Stock official php-fpm images set clear\_env = no, so only a repo pool config triggers this.

**Impact.** Silent: FPM workers see no POSTHOG\_RELEASE\_ID, so every exception has no release.

**Rule location.** [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) (Give the release ID to the running app > Tips: PHP-FPM clear\_env, Examples: PHP-FPM pool config in the repo)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `php`, `laravel`, `php-fpm`

**Wrong:**

```ini
; pool.d/www.conf
[www]
clear_env = yes      ; workers never see POSTHOG_RELEASE_ID
```

**Fixed:**

```ini
; pass the release ID from the master process to the workers
; (the master needs it first, e.g. from the container ENV)
env[POSTHOG_RELEASE_ID] = $POSTHOG_RELEASE_ID
```

## Releases created on every branch build

**Problem.** The agent adds the resolve step to the first job it finds, often test or a deploy job that also runs on PRs. It does not know that resolving creates the release.

**Impact.** PostHog gets a new release for every branch, preview and PR build.

**Rule location.**

- [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) ("Find the production deploy" and Tips)
- [`context-mill: context/agents/error-tracking/link-releases.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/error-tracking/link-releases.md) (task part 2: resolve in the production deploy job and no other)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `all`

**Wrong:**

```yaml
on: [pull_request, push]
jobs:
  test:
    steps:
      - uses: PostHog/resolve-release@v1   # creates a release per branch
```

**Fixed:**

```yaml
jobs:
  deploy:                       # production deploy job only
    steps:
      - id: posthog-release
        uses: PostHog/resolve-release@v1
        # deploy job also runs on PRs? gate the step, e.g.
        # if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

## Parallel deploy jobs race to create release

**Problem.** With a matrix or separate web and worker deploys, copying the step into each job looks symmetric. The agent does not expect two jobs to create the same new release at once.

**Impact.** Both jobs try to create the release, and one of them fails the deploy.

**Rule location.** [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) (Find the production deploy, Tips)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `github-actions`

**Wrong:**

```yaml
jobs:
  deploy-web:
    steps: [{ uses: PostHog/resolve-release@v1 }]
  deploy-worker:
    steps: [{ uses: PostHog/resolve-release@v1 }]   # same new release, same time
```

**Fixed:**

```yaml
jobs:
  release:
    outputs:
      release-id: ${{ steps.posthog-release.outputs.release-id }}
  deploy-web:
    needs: release     # reads ${{ needs.release.outputs.release-id }}
  deploy-worker:
    needs: release
```

## Release step breaks on slim CI images

**Problem.** On GitLab, CircleCI or Jenkins, the agent assumes npm or posthog-cli exists in the job image, as it would on a dev machine.

**Impact.** The job fails on images without Node or curl (for example ruby:3.3-slim), or the release ID comes out empty without any error.

**Rule location.** [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) (Resolve the release in CI > Examples, "GitLab CI, CircleCI, Jenkins, Bitbucket, and other providers")

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `ruby`, `sinatra`, `python`, `php`, `gitlab-ci`

**Wrong:**

```yaml
deploy:
  image: ruby:3.3-slim
  script:
    - npm install -g @posthog/cli     # no Node in this image
    - export POSTHOG_RELEASE_ID="$(posthog-cli release resolve)"
```

**Fixed:**

```yaml
deploy:
  script:
    # slim image: apt-get install -y curl first
    - curl --proto '=https' --tlsv1.2 -LsSf https://download.posthog.com/cli | sh
    - export PATH="$HOME/.posthog:$PATH"
    - export POSTHOG_RELEASE_ID="$(posthog-cli release resolve || true)"
    - ./deploy.sh   # must hand POSTHOG_RELEASE_ID to the app
```
