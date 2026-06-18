/**
 * AiOptInDemo — Playground demo for AiOptInRequiredScreen.
 *
 * Mounts the real screen with a synthetic store pre-populated with an
 * apiUser whose org has `is_ai_data_processing_approved: false`.
 * Variant selection is driven by `membership_level` — admin (>= 8) vs
 * non-admin (< 8), matching what the screen reads in production.
 *
 * One demo function, used by two PlaygroundApp tabs. ⚠ keybindings on
 * the screen are LIVE — [E] exits the playground, [O] opens a real
 * browser URL, [R] fires a network request (which will fail with the
 * fake token, but won't be destructive).
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { WizardStore } from '@ui/tui/store';
import { AiOptInRequiredScreen } from '@ui/tui/screens/AiOptInRequiredScreen';

type Variant = 'admin' | 'non-admin';

interface AiOptInDemoProps {
  variant: Variant;
}

export const AiOptInDemo = ({ variant }: AiOptInDemoProps) => {
  const [store] = useState(() => {
    const s = new WizardStore();
    s.setCredentials({
      accessToken: 'demo-fake-token',
      projectApiKey: 'demo-fake-project-key',
      host: 'https://us.posthog.com',
      projectId: 0,
    });
    return s;
  });

  useEffect(() => {
    store.session.region = 'us';
    store.setApiUser({
      distinct_id: 'demo-distinct-id',
      email: 'sarah@example.com',
      organization: {
        id: '00000000-0000-0000-0000-000000000000',
        name: 'Demo Org',
        membership_level: variant === 'admin' ? 8 : 1,
        is_ai_data_processing_approved: false,
      } as never,
      organizations: [],
      team: {
        id: 0,
        organization: '00000000-0000-0000-0000-000000000000',
      } as never,
    } as never);
  }, [variant, store]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text dimColor>
          Playground —{' '}
          <Text bold>
            AiOptInRequiredScreen ({variant === 'admin' ? 'Admin' : 'Non-admin'}
            )
          </Text>
          . Keys are live: [E] exits the playground.
        </Text>
      </Box>
      <AiOptInRequiredScreen store={store} />
    </Box>
  );
};
