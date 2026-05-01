import { Box, Text } from 'ink';
import { buildMaxUrl, TerminalLink } from './maxLink.js';

const PostHogAiPrompt = ({ prompt }: { prompt: string }) => (
  <Box flexDirection="column">
    <Text>Try asking PostHog AI</Text>
    <Box height={1} />
    <TerminalLink url={buildMaxUrl(prompt)}>
      <Text color="cyan" bold underline>
        "{prompt}" ↗
      </Text>
    </TerminalLink>
  </Box>
);

/** Build a slide that displays a Max prompt and carries its deep-link. */
const askMax = (prompt: string) =>
  Object.assign(() => <PostHogAiPrompt prompt={prompt} />, {
    link: buildMaxUrl(prompt),
  });

export const AiQueryDraftingSlide = askMax(
  'What changed in activation this week, and which events explain the movement?',
);

export const AiSessionReviewSlide = askMax(
  'Summarize sessions where users dropped off at checkout.',
);

export const AiIncidentTriageSlide = askMax(
  'Why is this exception happening, and which users and flows are affected?',
);

export const ReplayMcpFixSlide = askMax(
  'Find session replays around this error and summarize the steps that led to it.',
);

export const AiDashboardBuilderSlide = askMax(
  'Create a dashboard for signup, activation, retention, and paid conversion.',
);

export const AiReplayPatternsSlide = askMax(
  'What patterns do you see in sessions with rage clicks?',
);

export const AiMcpWorkflowSlide = askMax(
  'Find sessions around this error and give my coding agent the context to fix it.',
);

export const AiModelCostSlide = askMax(
  'Which prompts and models have the highest latency and cost this week?',
);

export const AiQualityRegressionSlide = askMax(
  'Did output quality regress after our last prompt or model change?',
);
