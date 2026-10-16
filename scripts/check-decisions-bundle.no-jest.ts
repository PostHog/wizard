/**
 * Fails when the Decisions service leaks into a production build. Builds the
 * wizard as `npm publish` would, into a temporary folder, and searches it for
 * code only the service contains. Run with `pnpm check:decisions-bundle`.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Strings that exist only inside the Decisions service. */
const MARKERS = [
  '/v1/systemone',
  'runProgramDecisions',
  'decisionsScan',
  'judgeMissingIntegration',
  // The question catalog.
  'Which framework or platform should the PostHog wizard integrate first',
];

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-prod-bundle-'));
try {
  try {
    execFileSync('pnpm', ['exec', 'tsdown', '--out-dir', outDir], {
      env: { ...process.env, WIZARD_BUILD_NODE_ENV: 'production' },
      stdio: 'pipe',
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    console.error(
      `The production build failed. A static import of a dev-only module resolves to an empty stub there; reach it through an import() behind !IS_PRODUCTION_BUILD.\n${stderr.slice(
        -1500,
      )}`,
    );
    process.exit(1);
  }
  const leaks = fs
    .readdirSync(outDir)
    .filter((file) => file.endsWith('.js'))
    .flatMap((file) => {
      const text = fs.readFileSync(path.join(outDir, file), 'utf8');
      return MARKERS.filter((m) => text.includes(m)).map(
        (m) => `${file}: ${m}`,
      );
    });
  if (leaks.length > 0) {
    console.error(
      `The Decisions service is in the production build:\n  ${leaks.join(
        '\n  ',
      )}\nReach it only through an import() behind !IS_PRODUCTION_BUILD; see tsdown.config.ts.`,
    );
    process.exitCode = 1;
  } else {
    console.log('The production build contains no Decisions service code.');
  }
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
