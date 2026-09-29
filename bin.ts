#!/usr/bin/env node
import { satisfies } from 'semver';
import { ErrorCodes } from '@shared/errors/codes.js';
import { emitWizardError } from '@shared/errors/emit.js';

// Keep in sync with `engines.node` in package.json. npx does not enforce
// engines, so this preflight is the only thing standing between an old Node
// runtime and a cryptic dependency crash (e.g. undici's markAsUncloneable
// TypeError on Node < 22.10).
const NODE_VERSION_RANGE = '>=22.22.0';

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
  emitWizardError({
    code: ErrorCodes.CliNodeVersion,
    message: `Node ${process.version} is below the required range ${NODE_VERSION_RANGE}`,
  });
  process.exit(1);
}

// Loaded dynamically so no dependency is evaluated before the check above.
await import('./main');
