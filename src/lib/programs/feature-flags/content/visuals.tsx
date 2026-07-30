/**
 * Compact feature-flag diagrams for the Learn pane. Every line fits the
 * 37-character pane used at the narrowest split-view width.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

export const RELEASE_SWITCH: ContentBlock = {
  type: 'lines',
  interval: 350,
  pause: 7000,
  lines: [
    <Text bold>{'        deployed code'}</Text>,
    <Text color={Colors.muted}>{'              |'}</Text>,
    <Text bold color={Colors.accent}>
      {'        feature flag'}
    </Text>,
    <Text color={Colors.muted}>{'          /        \\'}</Text>,
    <Text>
      <Text color={Colors.muted}>{'       control'}</Text>
      <Text color="cyan">{'     change'}</Text>
    </Text>,
  ],
};

export const ROLLOUT_METER: ContentBlock = {
  type: 'lines',
  interval: 450,
  pause: 8000,
  lines: [
    <Text>
      <Text color={Colors.accent}>0% </Text>
      <Text color={Colors.muted}>{' [----------]'}</Text>
      <Text dimColor>{' safe start'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>10%</Text>
      <Text color="cyan">{' [#'}</Text>
      <Text color={Colors.muted}>{'---------]'}</Text>
      <Text dimColor>{' small group'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>50%</Text>
      <Text color="cyan">{' [#####'}</Text>
      <Text color={Colors.muted}>{'-----]'}</Text>
      <Text dimColor>{' wider release'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>100%</Text>
      <Text color="cyan">{' [##########]'}</Text>
      <Text dimColor>{' everyone'}</Text>
    </Text>,
  ],
};

export const SAFE_PATHS: ContentBlock = {
  type: 'lines',
  interval: 400,
  pause: 7000,
  lines: [
    <Text>
      <Text color={Colors.muted}>false</Text>
      <Text dimColor>{'       -> control'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.muted}>loading</Text>
      <Text dimColor>{'     -> control'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.muted}>unavailable</Text>
      <Text dimColor>{' -> control'}</Text>
    </Text>,
    <Text>
      <Text color="cyan">true</Text>
      <Text dimColor>{'        -> change'}</Text>
    </Text>,
  ],
};

export const EVALUATION_PLACEMENT: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 7000,
  lines: [
    <Text>
      <Text color={Colors.accent}>first paint</Text>
      <Text dimColor>{'  -> server + bootstrap'}</Text>
    </Text>,
    <Text>
      <Text color="cyan">later action</Text>
      <Text dimColor>{' -> client'}</Text>
    </Text>,
  ],
};

export const VERIFICATION_LOOP: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 8000,
  lines: [
    <Text>
      <Text color={Colors.accent}>{'  1  '}</Text>
      <Text>Run the control experience</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  2  '}</Text>
      <Text>Run the flagged experience</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  3  '}</Text>
      <Text>Confirm a live evaluation</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  4  '}</Text>
      <Text>Restore the safe rollout</Text>
    </Text>,
  ],
};
