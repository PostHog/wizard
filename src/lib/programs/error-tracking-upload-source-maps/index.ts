import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import { AgentSignals } from '@lib/agent/agent-interface';
import { ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM } from './steps.js';
import {
  SOURCE_MAPS_ABORT_CASES,
  SOURCE_MAPS_CONTEXT_KEYS,
  type SkillVariant,
} from './detect.js';
import { getContentBlocks } from './content/index.js';

const REPORT_FILE = 'posthog-source-maps-report.md';
const DOCS_URL = 'https://posthog.com/docs/error-tracking/upload-source-maps';

export const errorTrackingUploadSourceMapsConfig: ProgramConfig = {
  command: 'upload-sourcemaps',
  description: 'Upload source maps to PostHog Error Tracking',
  id: 'error-tracking-upload-source-maps',
  steps: ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM,
  reportFile: REPORT_FILE,
  getContentBlocks,
  requires: ['posthog-integration'],

  run: (session: WizardSession): Promise<ProgramRun> => {
    const variant = session.frameworkContext[
      SOURCE_MAPS_CONTEXT_KEYS.skillVariant
    ] as SkillVariant | undefined;
    const displayName = session.frameworkContext[
      SOURCE_MAPS_CONTEXT_KEYS.displayName
    ] as string | undefined;

    const skillId = variant
      ? `error-tracking-upload-source-maps-${variant}`
      : undefined;

    return Promise.resolve({
      integrationLabel: 'error-tracking-upload-source-maps',
      // Skill is installed by the agent (after the API-key choice is made)
      // rather than pre-installed by the runner, so leave skillId unset.
      successMessage: 'Source maps wired up!',
      reportFile: REPORT_FILE,
      docsUrl: DOCS_URL,
      spinnerMessage: 'Wiring up source maps...',
      estimatedDurationMinutes: 3,
      abortCases: SOURCE_MAPS_ABORT_CASES,

      customPrompt: (ctx) => {
        if (!skillId || !variant) {
          // Detection failed but the user got past the intro somehow.
          // Tell the agent to abort with a structured signal so the runner
          // renders a friendly outro.
          return `Detection did not pick a source maps skill variant for this project.
Emit: ${AgentSignals.ABORT} unsupported-platform
Then halt.`;
        }

        const settingsUrl = `${ctx.host.replace(/\/$/, '')}/project/${
          ctx.projectId
        }/settings/user-api-keys`;

        return `You are wiring up PostHog Error Tracking source map upload for this ${
          displayName ?? variant
        } project.

Project context:
- PostHog Project ID: ${ctx.projectId}
- PostHog Host: ${ctx.host}
- Detected platform: ${displayName ?? variant}
- Skill to use: ${skillId}
- Personal API keys settings page: ${settingsUrl}

Follow these steps IN ORDER. Do not skip or reorder.

STEP 1 — Obtain a personal API key from the user.
   Source maps upload requires a personal API key the user creates in their
   PostHog settings. The wizard cannot mint keys and you must never attempt
   to do so via the PostHog API or any other tool. The user supplies the
   key; you only receive it as a vaulted secret reference (so the raw
   value never enters this conversation).

   Call the wizard_ask MCP tool with exactly one sensitive question that
   both explains where to get the key and accepts it:
     {
       id: "api-key",
       prompt: "Paste your PostHog personal API key below.\\n\\nDon't have one yet? Create one here:\\n${settingsUrl}\\n\\nWhen creating the key, choose the 'Source map upload' preset, then come back and paste it here.",
       kind: "text",
       sensitive: true
     }
   Keep the \\n line breaks in the prompt exactly as written — the TUI
   renders them as separate lines (Ink's <Text> respects \\n).
   The answer comes back as { secretRef: "secret:..." } — never the raw
   string. Remember this secretRef for STEP 5.

   If wizard_ask is unavailable (CI / non-interactive), emit
   ${AgentSignals.ABORT} requires-interactive-mode and halt.

STEP 2 — Install the skill.
   Call install_skill (wizard-tools MCP server) with skillId "${skillId}".
   Do NOT run shell commands to install skills.
   If install fails, emit ${
     AgentSignals.ERROR_RESOURCE_MISSING
   } skill ${skillId} could not be installed.

STEP 3 — Load and follow the skill.
   Read the installed skill's SKILL.md and reference files. Make all
   bundler / build-config changes the skill instructs. Do not invent steps
   that are not in the skill — the skill is the source of truth for this
   platform.

STEP 4 — Make the credentials readable at build time.
   The skill's "Making credentials available at build time" section is the
   source of truth for HOW .env is loaded for the detected platform — read
   it and follow it. The wizard-specific rules layered on top:

   - If a loader is needed and the project doesn't already load .env,
     install \`dotenv\` SILENTLY — do NOT ask the user, do NOT call
     wizard_ask. Run detect_package_manager first, add \`dotenv\` as a
     devDependency in the background, and require/import it at the top of
     the relevant config file (\`require('dotenv').config()\`, or
     \`import 'dotenv/config'\` for ESM). Keep it to one line plus the
     dependency.
   - If source map upload runs as a separate \`posthog-cli\` step (a
     separate child process — see the skill), pass \`--env-file <path>\` to
     that command so the CLI reads the .env file directly (e.g.
     \`posthog-cli --env-file .env sourcemap upload ...\`). Do NOT ask the
     user to log in. Write all the POSTHOG_CLI_* vars to .env in STEP 5 as
     normal.
   - If the detected platform already loads .env, skip this step entirely.

STEP 5 — Seed the personal API key into the environment.
   Use the wizard-tools MCP server.
   - Reuse the env file the project already uses — do NOT create a new one.
     If the project already has an env file (the skill's "Picking the
     correct env file" section is the source of truth for which), write to
     that same file. The prerequisite PostHog integration step has usually
     already written POSTHOG_* vars to one — seed your keys alongside them
     rather than introducing a second file (e.g. don't add .env.local when
     a .env already exists).
   - First call check_env_keys on that file to see which keys exist (it
     returns present/absent, never values — don't read the file directly).
   - Then call set_env_values to write the key. Pass the secretRef from
     STEP 1 as the value object, not a literal string:
       values: {
         "POSTHOG_CLI_API_KEY": { secretRef: "<the ref from STEP 1>" },
         "POSTHOG_CLI_PROJECT_ID": "${ctx.projectId}",
         "POSTHOG_CLI_HOST": "${ctx.host}"
       }
     The variable names depend on which CLI/plugin the skill uses — follow
     the skill's reference. Common conventions:
       - posthog-cli direct upload → POSTHOG_CLI_API_KEY, POSTHOG_CLI_PROJECT_ID, POSTHOG_CLI_HOST
       - bundler plugin variants  → POSTHOG_API_KEY, POSTHOG_PROJECT_ID, POSTHOG_HOST
     You do not need to know the key value to write it — the wizard resolves
     the ref locally before writing the file.

STEP 6 — Identify the build AND run commands.
   Inspect the project to find two commands — you'll need both for the
   summary and (if the user opts in) for the test affordance step:

   a) The production BUILD command (uploads source maps). Look at:
     - package.json scripts ("build", "build:prod", etc.)
     - gradle wrapper / xcodebuild scheme / Makefile target as appropriate

   b) The RUN command that launches the built app so the user can actually
      click the test button / hit the test route. Resolve the EXACT command
      for THIS project — never leave it as a generic "start the app". Look at:
     - package.json scripts: prefer the one that serves the production
       build (e.g. "start", "preview", "serve") over the dev script when a
       build artifact is involved. For frameworks: Next.js → \`next start\`
       (usually \`npm run start\` after \`next build\`); Vite → \`npm run
       preview\`; plain Node → the "start" script or \`node <built entry>\`
       (e.g. \`node dist/index.js\` — read package.json "main"/"bin" and the
       build output dir to name the real file).
     - Node services with the test route: give the full command to start
       the server PLUS the exact URL/route to hit (e.g. \`node dist/server.js\`
       then \`curl http://localhost:3000/__posthog-test-error\`).
     - Mobile/native (Android/iOS/Flutter/React Native): give the run
       command the platform uses to launch on a device/simulator (e.g.
       \`npx react-native run-ios\`, \`flutter run\`, run from Android
       Studio / Xcode) rather than a web "start".

   Resolve concrete commands from the project's actual scripts/config —
   substitute the right package manager (from detect_package_manager). Do
   NOT run the build or the app yourself; the user runs them.
   If you cannot identify a build command, emit
   ${AgentSignals.ABORT} build command not found.

STEP 7 — Offer to test the local setup.
   Call wizard_ask:
     {
       id: "test-affordance",
       prompt: "Want me to help you test your local setup? I'll add a temporary test button (or route) to your app so you can confirm errors show up in Error Tracking with readable stack traces after your next build. I'll remove it once you've confirmed it works.",
       kind: "single",
       options: [
         { label: "Yes, help me test it", value: "yes" },
         { label: "No, I'll test on my own later",  value: "no"  }
       ]
     }

   If "no", skip to STEP 8.

   If "yes":

   a) Pick a platform-appropriate affordance for the detected variant
      (${displayName ?? variant}). Use distinctive, easy-to-find copy on
      the trigger (button label, route path) so the user can find the
      resulting event in the Error Tracking UI.

      The handler MUST call the PostHog SDK's exception-capture method
      directly — do NOT throw. Throwing creates a visible error overlay
      (in dev mode) and depends on the SDK's global error handler being
      wired correctly; calling captureException directly is deterministic
      and works the same across all platforms.

      Pass an Error (or platform-equivalent throwable) as the single
      argument. Do NOT pass a custom message string, do NOT pass extra
      properties, options, or a second argument. The stack trace on the
      Error is what gets source-map resolved. Common shapes:
        - posthog-js / posthog-node / posthog-react-native:
            posthog.captureException(new Error("PostHog source maps test"))
        - posthog-android (Kotlin):
            PostHog.capture("$exception") per the skill's reference
        - posthog-ios (Swift): posthog.capture(...) per the skill's
            reference
        - posthog-flutter:
            Posthog().captureException(Exception("PostHog source maps test"))

      Affordance placement by variant:
        - Browser / SPA / SSR (web, nextjs, react, nuxt, angular, vite,
          webpack, rollup): add a clearly-labeled button on the most
          obvious entry page (home / index / root layout) — e.g. "Test
          PostHog Error Tracking" — whose onClick calls
          posthog.captureException(new Error("PostHog source maps test")).
        - Node.js: add a temporary HTTP route (e.g.
          \`GET /__posthog-test-error\`) on the project's existing server
          whose handler calls
          posthog.captureException(new Error("PostHog source maps test"))
          and returns 200. If there is no HTTP layer, add the capture call
          to the project's existing entry/main script (the file behind
          package.json "main"/"bin" or the "start"/"dev" script, e.g.
          src/index.ts) rather than creating a new file — read it, add the
          single captureException call where it already initialises the
          PostHog client, and revert it in step (d). Only create a new
          throwaway script if the project has no suitable existing entry
          file. Tell the user the exact command / URL to hit.
        - React Native: add a visible Button on the main screen whose
          onPress calls
          posthog.captureException(new Error("PostHog source maps test")).
        - Android: add a Button on the launcher Activity whose onClick
          calls the PostHog SDK's exception capture method with a
          \`Throwable\`.
        - iOS: add a UIButton on the root view controller whose action
          calls the SDK's exception capture method with an \`NSError\`.
        - Flutter: add an ElevatedButton on the home widget whose
          onPressed calls Posthog().captureException(...).

   b) Before editing any file, READ it and note the exact contents you
      will restore in step (d). Keep the change minimal — one button / one
      route, no extra helpers, no new imports beyond the strict minimum.

   c) Pause for the user to test. Call wizard_ask with BOTH the build
      command and the run command you identified in STEP 6 baked into the
      prompt as literal, copy-pasteable commands — the user must run the
      build themselves to upload source maps and surface the test
      affordance, then run the app to trigger it. Never write a generic
      "start / open the app"; always substitute the exact run command (and
      the exact button label or route) for THIS project.

      IMPORTANT: separate each numbered step with \\n\\n in the prompt
      string so the TUI renders them as distinct lines instead of a wall
      of text. Ink's <Text> respects \\n as a line break:
        {
          id: "test-done",
          prompt: "1) Run \`<your detected build command>\` to upload source maps and build the app with the test button.\\n\\n2) Start the app with \`<your detected run command>\`, then click the \\"<your test button label>\\" button (or hit \`<your test route>\`).\\n\\n3) Open Error Tracking in PostHog (${ctx.host.replace(
            /\/$/,
            '',
          )}/project/${
          ctx.projectId
        }/error_tracking) and confirm the test error appears with a source-resolved stack trace pointing at real source files (not minified bundle paths).\\n\\nWhen you're done, select Continue and I'll revert the test code.",
          kind: "single",
          options: [{ label: "Continue (revert test code)", value: "continue" }]
        }

   d) Revert. Restore every file you touched in step (a) to the exact
      contents you captured in step (b). Re-read each file afterwards to
      confirm no remnants are left (stray imports, leftover handlers,
      orphan comments). Do not leave the test affordance in place under
      any circumstances — even if the user reports the test "didn't work",
      revert first and surface the failure in STEP 8 instead.

STEP 8 — Summarise and hand off.
   Tell the user clearly:
   - Which files you edited (paths only).
   - Which env-var KEY names you set in .env (never values).
   - Whether a test affordance was added and reverted (if STEP 7 ran).
   - The exact build command they need to run themselves to upload source
     maps — the wizard does not run builds. Examples by platform:
       npm run build / pnpm build / yarn build (JS)
       ./gradlew assembleRelease (Android)
       xcodebuild ... (iOS)
       flutter build apk / flutter build ios (Flutter)
   - Where to confirm the upload landed:
     ${ctx.host.replace(/\/$/, '')}/project/${
          ctx.projectId
        }/error_tracking/configuration
     under "Symbol sets". A new symbol set should appear after the build
     completes.

Important:
- Use detect_package_manager (wizard-tools MCP server) before running any
  npm/pnpm/yarn install commands.
- Always install packages in the background. Don't await completion.
- You must read a file immediately before writing it, even if you have
  already read it.
- You will never see the raw personal API key. Always pass secretRef
  objects to set_env_values. Never attempt to mint a key for the user —
  always direct them to the settings page.
`;
      },

      postRun: (sess) => {
        // Stash a hint for the outro about what variant we shipped.
        if (variant) {
          sess.frameworkContext['sourceMapsCompletedVariant'] = variant;
        }
        return Promise.resolve();
      },

      buildOutroData: (sess) => {
        const completed = sess.frameworkContext[
          'sourceMapsCompletedVariant'
        ] as SkillVariant | undefined;
        const changes = [
          completed
            ? `Configured source map upload for ${displayName ?? completed}`
            : '',
          'Added PostHog credentials to .env',
        ].filter(Boolean);

        return {
          kind: OutroKind.Success as const,
          message: 'Source maps wired up!',
          reportFile: REPORT_FILE,
          changes,
          docsUrl: DOCS_URL,
        };
      },
    });
  },
};

export { ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM } from './steps.js';
export {
  detectSourceMapsPrerequisites,
  SOURCE_MAPS_ABORT_CASES,
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANT_DISPLAY_NAME,
  type SkillVariant,
  type SourceMapsDetectError,
} from './detect.js';
