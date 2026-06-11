/**
 * SlackConnectScreen — the dedicated "Connect Slack" step shown after the
 * MCP tutorial (`wizard mcp tutorial`) and after a successful install
 * (`wizard mcp add`).
 *
 * Presents the PostHog Slack app plus role-tailored use-cases. The copy
 * adapts to whether Slack is already connected (`session.slackConnected`,
 * detected post-login):
 *   • not connected (or unknown) — nudge + "Open Slack setup", which
 *     launches the browser at the integration settings page. We link
 *     rather than wire it up: connecting Slack is a manual OAuth step.
 *   • already connected — confirm it and skip the connect CTA, so users
 *     who already have it aren't nagged.
 * Either path dismisses the step (`slackStepDismissed`) and lets the
 * router advance to exit.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import opn from 'opn';

import type { WizardStore } from '@ui/tui/store';
import { Colors, Icons } from '@ui/tui/styles';
import { PickerMenu } from '@ui/tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@ui/tui/hooks/useKeyBindings';
import { getSlackAppCard } from '@lib/mcp-role-prompts';
import { analytics } from '@utils/analytics';

interface SlackConnectScreenProps {
  store: WizardStore;
}

enum ChoiceValue {
  Open = 'open',
  Skip = 'skip',
}

export const SlackConnectScreen = ({ store }: SlackConnectScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const role = store.session.roleAtOrganization;
  const slack = getSlackAppCard();
  const connected = store.session.slackConnected === true;

  const dismiss = (choice: ChoiceValue): void => {
    if (choice === ChoiceValue.Open) {
      analytics.wizardCapture('slack connect opened', { role });
      // Fire-and-forget. opn throws in environments without a browser
      // (headless/remote) — the setup URL is printed on screen as a
      // fallback, so swallow the error.
      if (process.env.NODE_ENV !== 'test') {
        opn(slack.setupUrl, { wait: false }).catch(() => {
          // No browser available — the printed URL is the fallback.
        });
      }
    } else {
      analytics.wizardCapture('slack connect skipped', { role, connected });
    }
    store.setSlackStepDismissed();
  };

  const handleSelect = (value: ChoiceValue | ChoiceValue[]): void => {
    const choice = Array.isArray(value) ? value[0] : value;
    dismiss(choice);
  };

  useKeyBindings('slack-connect', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: connected ? 'done' : 'skip',
      handler: () => dismiss(ChoiceValue.Skip),
    },
  ]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginTop={1} flexDirection="column">
        {connected ? (
          <Text bold color={Colors.success}>
            {Icons.check} Slack connected
          </Text>
        ) : (
          <Text bold color={Colors.accent}>
            {slack.headline}
          </Text>
        )}

        <Box marginTop={1}>
          <Text>
            {connected
              ? "Slack is connected — here's what you can do:"
              : slack.pitch}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {slack.capabilities.map((capability, i) => (
            <Box key={i}>
              <Text color="cyan">{Icons.diamond}</Text>
              <Text> {capability}</Text>
            </Box>
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          {!connected && (
            <Text dimColor>
              Connect it: <Text color="cyan">{slack.setupUrl}</Text>
            </Text>
          )}
          <Text dimColor>
            Learn more: <Text color="cyan">{slack.learnMoreUrl}</Text>
          </Text>
        </Box>

        <Box marginTop={1}>
          <PickerMenu
            options={
              connected
                ? [{ label: 'Done', value: ChoiceValue.Skip }]
                : [
                    { label: 'Open Slack setup', value: ChoiceValue.Open },
                    { label: 'Skip', value: ChoiceValue.Skip },
                  ]
            }
            onSelect={handleSelect}
          />
        </Box>
      </Box>
    </Box>
  );
};
