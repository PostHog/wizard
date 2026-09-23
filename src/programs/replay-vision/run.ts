import type { AbortCase } from '@agent/types';
import type { SkillProgramOptions } from '../agent-skill/run-definition';

const REPLAY_VISION_REPORT_FILE = 'posthog-replay-vision-report.md';

export const REPLAY_VISION_ABORT_CASES: AbortCase[] = [
  {
    match: /^replay vision not available for this project$/i,
    message: 'Replay vision is not available for this project',
    body:
      'Every Replay vision scanner endpoint reported that the feature is not ' +
      'available here yet. Session replay setup done so far is kept. See ' +
      'https://posthog.com/docs/replay-vision for availability.',
  },
];

export const REPLAY_VISION_OPTIONS: SkillProgramOptions = {
  // The menu ids this skill `<dir>-<variant>`, and context-mill's
  // `replay-vision/config.yaml` declares a single variant, `setup`. The bare
  // `replay-vision` id does not exist — the orchestrator never installs this
  // (it resolves per-task mini-skills instead), but the linear path does, and
  // aborts `skill-not-found` on a miss.
  skillId: 'replay-vision-setup',
  command: 'replay-vision',
  id: 'replay-vision',
  description: 'Set up PostHog Replay Vision scanners for your product',
  integrationLabel: 'replay-vision',
  customPrompt:
    'Set up PostHog Replay vision. Run the `replay-vision` skill end-to-end: ' +
    'make sure session replay is recording (server-side enable plus a ' +
    'posthog-js init check), then create the vision scanners the skill ' +
    "defines, scoped to this product's key flows read out of the repo. If " +
    'PostHog is not integrated yet, install and initialize the SDK first as ' +
    'the skill instructs — do not abort. The final report is written to ' +
    `./${REPLAY_VISION_REPORT_FILE}.`,
  successMessage: `Replay vision configured! View the report at ./${REPLAY_VISION_REPORT_FILE}`,
  reportFile: REPLAY_VISION_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/replay-vision',
  spinnerMessage: 'Setting up Replay vision...',
  estimatedDurationMinutes: 6,
  abortCases: REPLAY_VISION_ABORT_CASES,
};
