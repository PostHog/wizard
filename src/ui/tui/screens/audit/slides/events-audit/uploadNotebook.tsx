import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const NotebookVisual = () => (
  <VisualBox>
    <Text dimColor>Events audit report</Text>
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
  area: 'Publish report',
  intro: [
    'Now we publish the report into a PostHog notebook so you can open it and share it with your team as a URL.',
    'Hang tight.',
    'Nothing lands in your project — the notebook is the copy you keep.',
  ],
  visual: <NotebookVisual />,
  docsUrl: 'https://posthog.com/docs/notebooks',
};
