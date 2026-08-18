import type { AbortCase } from '@lib/agent/agent-runner';
import { createSkillProgram } from '@lib/programs/agent-skill/index';

const REPLAY_VISION_REPORT_FILE = 'posthog-replay-vision-report.md';

/**
 * `[ABORT]` reasons the replay-vision skill emits when setup can't proceed.
 * Kept in sync with the stop conditions in the skill's `description.md`
 * (context-mill `context/skills/replay-vision`).
 */
export const REPLAY_VISION_ABORT_CASES: AbortCase[] = [
  {
    match: /^posthog not integrated - run the base wizard first$/i,
    message: 'PostHog is not integrated in this project yet',
    body:
      'Replay Vision scans session recordings, so PostHog (with session ' +
      'replay) has to be installed first. Run `npx @posthog/wizard` to set ' +
      'up PostHog, then run `wizard replay-vision` again.',
  },
  {
    match: /^replay vision not available for this project$/i,
    message: 'Replay Vision is not available for this project',
    body:
      "This PostHog instance doesn't expose the Replay Vision scanner API, " +
      'so there is nothing to configure. See ' +
      'https://posthog.com/docs/replay-vision for availability.',
  },
];

/**
 * `wizard replay-vision` — flat skill command.
 *
 * Turns on session replay if needed, then reads the repo to create Replay
 * Vision scanners scoped to the product's key flows. Flat while setup is the
 * only action.
 */
export const replayVisionConfig = createSkillProgram({
  skillId: 'replay-vision-setup',
  command: 'replay-vision',
  id: 'replay-vision',
  description: 'Set up PostHog Replay Vision scanners for your key flows',
  integrationLabel: 'replay-vision',
  customPrompt:
    'Set up PostHog Replay Vision for this project. Run the ' +
    '`replay-vision-setup` skill end-to-end: make sure session replay is ' +
    'recording (server-side enable plus the posthog-js init check), then ' +
    'read the repo to scope and create the scanner skeletons the skill ' +
    'defines. Make only the additive code change the skill allows. The ' +
    `final report is written to ./${REPLAY_VISION_REPORT_FILE}.`,
  successMessage: `Replay Vision configured! View the report at ./${REPLAY_VISION_REPORT_FILE}`,
  reportFile: REPLAY_VISION_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/replay-vision',
  spinnerMessage: 'Setting up Replay Vision...',
  estimatedDurationMinutes: 5,
  abortCases: REPLAY_VISION_ABORT_CASES,
});
