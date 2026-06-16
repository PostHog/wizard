/**
 * RecommendedNextScreen — post-install discoverability for other PostHog
 * programs the project looks like a good fit for (e.g. revenue analytics when
 * Stripe is present).
 *
 * Product-agnostic: it renders whatever `getPromotableRecommendations` returns
 * from the registry. Good fits are pre-selected. Confirming writes the picks to
 * `session.recommendedFollowUps` (the modular seam); skipping writes an empty
 * list. Either way the screen completes and the flow advances. On exit those
 * picks are printed as `npx` commands (see exit-line.ts).
 *
 * This screen only sets state — the router advances to the next step. It never
 * exits the process itself.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import { getPromotableRecommendations } from '@lib/programs/promotable';
import { GroupedPickerMenu } from '@ui/tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@ui/tui/hooks/useKeyBindings';
import { Colors } from '@ui/tui/styles';

interface RecommendedNextScreenProps {
  store: WizardStore;
}

export const RecommendedNextScreen = ({
  store,
}: RecommendedNextScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const recommendations = getPromotableRecommendations(store.session);

  // Esc skips everything — the router's `show` predicate keeps this screen out
  // of the flow entirely when there are no recommendations, so this handler
  // only runs when there's something to skip.
  useKeyBindings('recommended-next', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: 'skip',
      handler: () => store.setRecommendedFollowUps([]),
    },
  ]);

  const options = recommendations.map((config) => ({
    value: config.id,
    label: config.promotable!.label,
    hint: config.promotable!.description,
  }));

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Recommended next
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Based on your project, you might also want to set these up. We&apos;ll
          print the commands to run when the wizard exits.
        </Text>

        <Box marginTop={1}>
          <GroupedPickerMenu
            groups={{ 'Set up with PostHog': options }}
            initialSelected={recommendations.map((config) => config.id)}
            onSelect={(values) => store.setRecommendedFollowUps(values)}
          />
        </Box>
      </Box>
    </Box>
  );
};
