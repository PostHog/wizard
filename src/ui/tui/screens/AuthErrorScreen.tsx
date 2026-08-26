/**
 * AuthErrorScreen — Shown when the PostHog LLM Gateway returns a 401.
 *
 * Distinct causes, in priority order:
 *  1. A stored Claude login (managed key) shadowed the wizard's token.
 *  2. Claude Code settings.json / managed-settings overrides ANTHROPIC_*
 *     env vars — auth conflict. Tell the user to log out of Claude Code.
 *  3. The PostHog token itself was rejected. When the gateway named the reason
 *     (expired, missing scope, wrong region), show that concrete cause and its
 *     next step; otherwise list the common causes. Don't blame Claude Code.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { GatewayAuthReason } from '@lib/agent/output-signals';
import type { WizardStore } from '@ui/tui/store';
import { Colors } from '@ui/tui/styles';
import { useDismissOnAnyKey } from '@ui/tui/hooks/useDismissOnAnyKey';

interface AuthErrorScreenProps {
  store: WizardStore;
}

/**
 * Copy for a rejected gateway token whose concrete reason the gateway named.
 * Returns null for `unknown`, where the screen lists the common causes instead.
 */
function rejectedTokenCopy(
  reason: GatewayAuthReason,
  region?: 'eu' | 'us' | 'local',
): { headline: string; step: ReactNode } | null {
  switch (reason) {
    case 'expired':
      return {
        headline:
          'The PostHog LLM Gateway rejected the token: it has expired or been revoked.',
        step: (
          <>
            Create a new personal API key with the{' '}
            <Text color="cyan">llm_gateway:read</Text> scope, then re-run the
            Wizard.
          </>
        ),
      };
    case 'missing_scope':
      return {
        headline:
          'The PostHog LLM Gateway rejected the token: it is missing the required scope.',
        step: (
          <>
            Give the key the <Text color="cyan">llm_gateway:read</Text> scope
            (or create a new key with it), then re-run the Wizard.
          </>
        ),
      };
    case 'wrong_region':
      return {
        headline: `The PostHog LLM Gateway rejected the token: it was issued for a different region${
          region ? ` (this run used ${region})` : ''
        }.`,
        step: (
          <>
            Re-run with <Text color="cyan">--region</Text> matching where the
            key was issued (us vs eu).
          </>
        ),
      };
    default:
      return null;
  }
}

export const AuthErrorScreen = ({ store }: AuthErrorScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  useDismissOnAnyKey(() => process.exit(1));

  const detail = store.session.authErrorDetail;
  const hasSettingsConflict = detail?.hasSettingsConflict ?? true;
  const conflicts = detail?.conflicts ?? [];
  const usingManagedLogin = detail?.usingManagedLogin ?? false;
  const credentialPlaces = detail?.credentialPlaces ?? [];
  const gatewayReason = detail?.gatewayReason ?? 'unknown';
  const gatewayErrorMessage = detail?.gatewayErrorMessage;
  const reasonCopy = rejectedTokenCopy(gatewayReason, detail?.region);
  const logFilePath = detail?.logFilePath;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text color="red" bold>
        {'✘'} Authentication error
      </Text>

      {usingManagedLogin ? (
        <>
          <Box flexDirection="column" marginTop={1}>
            <Text>
              Conflicting Anthropic credentials. The agent signed in with an
              existing Claude login instead of the PostHog token the Wizard
              provided, so the LLM Gateway rejected it (401).
            </Text>
          </Box>

          {credentialPlaces.length > 0 && (
            <Box flexDirection="column" marginTop={1} paddingLeft={2}>
              <Text dimColor>Conflicting credentials may come from:</Text>
              {credentialPlaces.map((place) => (
                <Text key={place}>
                  {'•'} {place}
                </Text>
              ))}
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Log out of Claude Code (clears the stored login), then re-run the
              Wizard:
            </Text>
          </Box>

          <Box flexDirection="column" marginTop={1} paddingLeft={2}>
            <Text color="cyan">claude auth logout</Text>
          </Box>
        </>
      ) : hasSettingsConflict ? (
        <>
          <Box flexDirection="column" marginTop={1}>
            <Text>
              The Wizard couldn't connect to the PostHog LLM Gateway. Claude
              Code settings on this machine override the Wizard's credentials.
            </Text>
          </Box>

          {conflicts.length > 0 && (
            <Box flexDirection="column" marginTop={1} paddingLeft={2}>
              {conflicts.map((conflict) => (
                <Text key={conflict.path}>
                  {'•'} <Text bold>{conflict.path}</Text> sets{' '}
                  <Text color="yellow">{conflict.keys.join(', ')}</Text>
                </Text>
              ))}
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Remove those keys from the file(s) above, or log out of Claude
              Code, then re-run the Wizard:
            </Text>
          </Box>

          <Box flexDirection="column" marginTop={1} paddingLeft={2}>
            <Text color="cyan">claude auth logout</Text>
          </Box>
        </>
      ) : (
        <>
          {reasonCopy ? (
            <>
              <Box flexDirection="column" marginTop={1}>
                <Text>{reasonCopy.headline}</Text>
              </Box>
              <Box marginTop={1}>
                <Text dimColor>{reasonCopy.step}</Text>
              </Box>
            </>
          ) : (
            <>
              <Box flexDirection="column" marginTop={1}>
                <Text>
                  The PostHog LLM Gateway rejected the API key. Common causes:
                </Text>
              </Box>

              <Box flexDirection="column" marginTop={1} paddingLeft={2}>
                <Text>
                  {'•'} Wrong key type — pass a personal API key (
                  <Text color="cyan">phx_xxx</Text>).
                </Text>
                <Text dimColor>
                  {'  '}pha_ is an OAuth access token, phc_ is a project key.
                </Text>
                <Text>
                  {'•'} Missing scope — the key needs{' '}
                  <Text color="cyan">llm_gateway:read</Text>.
                </Text>
                <Text>{'•'} Expired or revoked key.</Text>
                <Text>
                  {'•'} Region mismatch — <Text color="cyan">--region</Text>{' '}
                  must match where the key was issued (us vs eu).
                </Text>
              </Box>
            </>
          )}

          {gatewayErrorMessage && (
            <Box marginTop={1} paddingLeft={2}>
              <Text dimColor>Gateway said: {gatewayErrorMessage}</Text>
            </Box>
          )}
        </>
      )}

      {logFilePath && (
        <Box marginTop={1}>
          <Text dimColor>Verbose log: {logFilePath}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to exit</Text>
      </Box>
    </Box>
  );
};
