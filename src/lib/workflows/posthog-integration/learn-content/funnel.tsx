/**
 * ASCII funnel — illustrates a conversion funnel insight for a ride app.
 */

import { Text } from 'ink';
import type { ContentBlock } from '../../../../ui/tui/primitives/index.js';

export const FUNNEL_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 200,
  pause: 8000,
  lines: [
    <Text bold>{'  Funnel · ride conversion'}</Text>,
    <Text> </Text>,
    // Step 1
    <Text>
      {'  '}
      <Text bold>1</Text>
      {'  app_launched'}
      {'                     '}
      <Text bold color="green">
        100.00%
      </Text>
    </Text>,
    <Text color="cyan">{'     ██████████████████████████████'}</Text>,
    <Text dimColor>{'     → 1,200 users'}</Text>,
    <Text> </Text>,
    // Step 2
    <Text>
      {'  '}
      <Text bold>2</Text>
      {'  ride_requested'}
      {'       '}
      <Text dimColor>{'avg 2m 30s'}</Text>
      {'   '}
      <Text bold color="green">
        72.00%
      </Text>
    </Text>,
    <Text>
      {'     '}
      <Text color="cyan">{'██████████████████████'}</Text>
      <Text dimColor>{'░░░░░░░░░'}</Text>
    </Text>,
    <Text>
      {'     '}
      <Text dimColor>→ 864 users</Text>
      {'  '}
      <Text color="red">↘</Text>
      <Text dimColor>{' 336 (28%)'}</Text>
    </Text>,
    <Text> </Text>,
    // Step 3
    <Text>
      {'  '}
      <Text bold>3</Text>
      {'  ride_accepted'}
      {'        '}
      <Text dimColor>{'avg 5m 12s'}</Text>
      {'   '}
      <Text bold color="green">
        51.00%
      </Text>
    </Text>,
    <Text>
      {'     '}
      <Text color="cyan">{'██████████████████'}</Text>
      <Text dimColor>{'░░░░░░░░░░░░░'}</Text>
    </Text>,
    <Text>
      {'     '}
      <Text dimColor>→ 612 users</Text>
      {'  '}
      <Text color="red">↘</Text>
      <Text dimColor>{' 252 (29%)'}</Text>
    </Text>,
    <Text> </Text>,
    // Step 4
    <Text>
      {'  '}
      <Text bold>4</Text>
      {'  ride_started'}
      {'         '}
      <Text dimColor>{'avg 1m 45s'}</Text>
      {'   '}
      <Text bold color="green">
        38.00%
      </Text>
    </Text>,
    <Text>
      {'     '}
      <Text color="cyan">{'█████████████'}</Text>
      <Text dimColor>{'░░░░░░░░░░░░░░░░░░'}</Text>
    </Text>,
    <Text>
      {'     '}
      <Text dimColor>→ 456 users</Text>
      {'  '}
      <Text color="red">↘</Text>
      <Text dimColor>{' 156 (25%)'}</Text>
    </Text>,
  ],
};
