import type { ProgramConfig, ProgramSession } from '@programs/program-contract';
import type { AbortCase } from '@agent/types';
import {
  describeSidecarVendors,
  detectSidecarVendors,
  SIDECAR_VENDORS_KEY,
  type SidecarVendorMatch,
} from './detect.js';

const SIDECAR_SKILL_ID = 'side-car';
const SIDECAR_REPORT_FILE = 'posthog-side-car-report.md';

const SIDECAR_ABORT_CASES: AbortCase[] = [
  {
    match: /^no supported analytics sdk found$/i,
    message: 'No supported analytics SDK found',
    body:
      'The side-car bridges an existing Amplitude, Mixpanel, Segment or Heap ' +
      'browser integration into PostHog. None of them appear in this project. ' +
      'To add PostHog from scratch, run `npx @posthog/wizard@latest`.',
  },
  {
    match: /^several analytics sdks found$/i,
    message: 'Several analytics SDKs found',
    body:
      'This project uses more than one supported analytics vendor, and the ' +
      'side-car bridges one. Run `wizard side-car` interactively to pick which one.',
  },
];

export const config: ProgramConfig = {
  command: 'side-car',
  description:
    'Forward Amplitude, Mixpanel, Segment or Heap calls to PostHog with a side-car plugin',
  id: 'side-car',
  skillId: SIDECAR_SKILL_ID,
  reportFile: SIDECAR_REPORT_FILE,
  allowedTools: ['Agent'],
  onReady: (ctx) => detectSidecarVendors(ctx.session, ctx.setFrameworkContext),
  run: (session: ProgramSession) => {
    const vendors = (session.frameworkContext[SIDECAR_VENDORS_KEY] ??
      []) as SidecarVendorMatch[];
    return Promise.resolve({
      skillId: SIDECAR_SKILL_ID,
      integrationLabel: 'side-car',
      customPrompt: () =>
        'Add a PostHog side-car to this project. Run the `side-car` skill ' +
        'end-to-end: follow the step chain starting at references/1-detect.md. ' +
        'Never edit existing vendor call sites; only add the side-car files, ' +
        'the PostHog init, and one plugin registration. ' +
        `${describeSidecarVendors(vendors)} ` +
        `The final report is written to ./${SIDECAR_REPORT_FILE}.`,
      successMessage: `Side-car installed! View the report at ./${SIDECAR_REPORT_FILE}`,
      reportFile: SIDECAR_REPORT_FILE,
      docsUrl: 'https://posthog.com/docs/libraries/js',
      spinnerMessage: 'Installing the PostHog side-car...',
      estimatedDurationMinutes: 6,
      abortCases: SIDECAR_ABORT_CASES,
    });
  },
};

export {
  detectSidecarVendors,
  findSidecarVendors,
  SIDECAR_VENDOR_PACKAGES,
  type SidecarVendor,
  type SidecarVendorMatch,
} from './detect.js';
