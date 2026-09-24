import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const NotebookVisual = () => (
  <VisualBox>
    <Text dimColor>posthog-events-audit-report.md</Text>
    <Text dimColor>{'  │'}</Text>
    <Text>
      <Text dimColor>{'  ▼ '}</Text>
      <Text color="cyan">PostHog notebook</Text>
    </Text>
    <Text dimColor>{'     # Identity & segmentation'}</Text>
    <Text dimColor>{'     # Coverage map'}</Text>
    <Text dimColor>{'     # Events by file & area'}</Text>
  </VisualBox>
);

export const UploadNotebookSlide: AreaSlide = {
  area: 'Upload notebook',
  intro: [
    'Next we upload the report into a PostHog notebook so you can share it with your team as a URL.',
    'Hang tight.',
    'The markdown file on disk is still there for you to read locally.',
  ],
  visual: <NotebookVisual />,
  docsUrl: 'https://posthog.com/docs/notebooks',
};
