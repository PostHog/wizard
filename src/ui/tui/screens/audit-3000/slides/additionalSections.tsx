import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../../audit/slides/shared.js';

const AdditionalSectionsVisual = () => (
  <VisualBox>
    <Text>
      <Text color="cyan">{'customer enrichment'}</Text>
      <Text dimColor>{'  Harmonic / PDL'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'use-case match     '}</Text>
      <Text dimColor>{'  playbook scoring'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'audit notebook     '}</Text>
      <Text dimColor>{'  written to your tenant'}</Text>
    </Text>
  </VisualBox>
);

export const AdditionalSectionsSlide: AreaSlide = {
  area: 'Wrap-up & notebook',
  intro: [
    'Wrapping up — enrichment, use-case match, and writing the final audit notebook into your PostHog project.',
    "If a Harmonic key is present, we pull a company profile (industry, scale, traction signals). If PDL is available, we add an operator profile. These don't change the score — they give downstream readers the business context for the technical findings.",
    "Then we score the enriched profile against PostHog's product playbooks (product intelligence, AI agents, conversion optimization, etc.) and pick a primary + secondary fit. Finally, everything is composed into a notebook inside your PostHog project — that's the artifact you'll share.",
  ],
  visual: <AdditionalSectionsVisual />,
  docsUrl: 'https://posthog.com/docs',
};
