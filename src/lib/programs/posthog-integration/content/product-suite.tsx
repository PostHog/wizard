/**
 * PRODUCT_SUITE_BLOCK — Two-column listing of PostHog products.
 */

import { Text } from 'ink';
import type { ContentBlock } from '../../../../ui/tui/primitives/content-types.js';

export const PRODUCT_SUITE_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 1000,
  pause: 15000,
  lines: [
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Product Analytics     '}
      <Text color="cyan">{'◆ '}</Text>
      {'Error Tracking'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Web Analytics         '}
      <Text color="cyan">{'◆ '}</Text>
      {'Session Replay'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Feature Flags         '}
      <Text color="cyan">{'◆ '}</Text>
      {'Data Pipelines'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Experiments           '}
      <Text color="cyan">{'◆ '}</Text>
      {'Data Warehouse'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'LLM Analytics         '}
      <Text color="cyan">{'◆ '}</Text>
      {'Surveys'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Programs             '}
      <Text color="cyan">{'◆ '}</Text>
      {'Logs'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Product Tours         '}
      <Text color="cyan">{'◆ '}</Text>
      {'Support'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Revenue Analytics     '}
      <Text color="cyan">{'◆ '}</Text>
      {'Endpoints'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Customer Analytics    '}
      <Text color="cyan">{'◆ '}</Text>
      {'PostHog Code'}
    </Text>,
  ],
};
