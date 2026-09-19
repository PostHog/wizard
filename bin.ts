#!/usr/bin/env node
import { satisfies } from 'semver';
import { Agent, setGlobalDispatcher } from 'undici';

// Keep in sync with `engines.node` in package.json. npx does not enforce
// engines, so this preflight is the only thing standing between an old Node
// runtime and a cryptic dependency crash (e.g. undici's markAsUncloneable
// TypeError on Node < 22.10).
const NODE_VERSION_RANGE = '>=22.22.0';

/*
 * TODO(#1198): remove when fetch over HTTP/2 is safe on Node 26. Remove when all
 * of these are true:
 *  - nodejs/node no longer creates an orphan ClientHttp2Stream when a client
 *    session gets HEADERS for a stream id it already reset. Repro: abort a fetch
 *    before its response headers, then idle 4s on Node 26. Fixed when the
 *    process survives.
 *  - modelcontextprotocol/typescript-sdk#2526 is closed.
 *  - pi-coding-agent's CLI drops `allowH2: false` from its http-dispatcher.
 * Same workaround as pi's CLI and typescript-sdk#2526: HTTP/1.1 only.
 */
setGlobalDispatcher(new Agent({ allowH2: false }));

if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  // eslint-disable-next-line no-console
  console.log(
    [
      `The PostHog wizard needs a newer version of Node.js to run.`,
      ``,
      `  You have:  ${process.version}`,
      `  You need:  v${NODE_VERSION_RANGE.replace('>=', '')} or later`,
      ``,
      `To update Node.js:`,
      ``,
      `  Download the latest version from https://nodejs.org/en/download`,
      `  Or, if you use nvm, run: nvm install 22 && nvm use 22`,
      ``,
      `Then run the wizard again. Stuck? Email wizard@posthog.com and we'll help.`,
    ].join('\n'),
  );
  // Same line emitWizardError prints; inlined so no surface loads before this check.
  process.stderr.write(
    `phw-error: ${JSON.stringify({
      code: 'PHW_CLI_NODE_VERSION',
      message: `Node ${process.version} is below the required range ${NODE_VERSION_RANGE}`,
    })}\n`,
  );
  process.exit(1);
}

// Test mock server — only loaded when NODE_ENV is 'test'.
// In production builds, tsdown replaces process.env.NODE_ENV with 'production',
// making this block dead code.
if (process.env.NODE_ENV === 'test') {
  void (async () => {
    try {
      const { server } = await import('./e2e-tests/mocks/server.js');
      server.listen({
        onUnhandledRequest: 'bypass',
      });
    } catch (error) {
      // Mock server import failed - this can happen during non-E2E tests
    }
  })();
}

// Surfaces load only after the preflight passed.
await import('./src/cli/main.js');
