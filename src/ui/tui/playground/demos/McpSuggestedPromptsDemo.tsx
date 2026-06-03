/**
 * McpSuggestedPromptsDemo — Playground demo for the post-MCP suggested-prompts screen.
 *
 * Seeds the store with a role, an integration, credentials, and one
 * installed MCP client so the real McpSuggestedPromptsScreen renders. The
 * activity_log poll hits an unreachable host and fails fast, so the verify
 * phase falls through to TimedOut after 30s (or hit [v] / [enter] from the
 * screen itself to short-circuit).
 *
 *   R   cycle role (null → founder → product → ... → data → null)
 *   F   cycle framework family (null → nextjs → vue → swift → django → null)
 *   X   reset verify phase (remount the screen)
 *
 * Cycling R or F surfaces both the role kit and the role × family
 * overrides without leaving the demo.
 */

import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { McpSuggestedPromptsScreen } from '@ui/tui/screens/McpSuggestedPromptsScreen';
import { Colors } from '@ui/tui/styles';
import { Integration } from '@lib/constants';
import { McpOutcome } from '@lib/wizard-session';
import { TAILORED_ROLES } from '@lib/mcp-role-prompts';

// One Integration per framework family so cycling exercises every override
// bucket in mcp-role-prompts.ts.
const FAMILY_INTEGRATIONS: Array<Integration | null> = [
  null,
  Integration.nextjs, // fullstack
  Integration.vue, // frontend-web
  Integration.swift, // mobile
  Integration.django, // backend
];

const ROLE_CYCLE: Array<string | null> = [null, ...TAILORED_ROLES];

interface McpSuggestedPromptsDemoProps {
  store: WizardStore;
}

export const McpSuggestedPromptsDemo = ({
  store,
}: McpSuggestedPromptsDemoProps) => {
  const [roleIdx, setRoleIdx] = useState(2); // start on 'product' — has overrides
  const [familyIdx, setFamilyIdx] = useState(1); // start on nextjs (fullstack)
  const [resetKey, setResetKey] = useState(0);

  const role = ROLE_CYCLE[roleIdx];
  const integration = FAMILY_INTEGRATIONS[familyIdx];

  // Push demo state into the real store so the screen's useSyncExternalStore
  // picks it up. Re-runs whenever role or integration cycle.
  useEffect(() => {
    store.setRoleAtOrganization(role);
    // Credentials point at an unreachable host — fetchRecentActivity catches
    // and returns []. Net effect: the verify phase polls harmlessly and
    // either the user hits [v] / [enter] or the 30s timeout fires.
    store.setCredentials({
      accessToken: 'demo-token',
      projectApiKey: 'phc_demo',
      host: 'http://127.0.0.1:1',
      projectId: 1,
    });
    // setMcpComplete also seeds mcpInstalledClients, which the screen reads
    // to name the agent in the verify copy ("Paste this into Claude Code…").
    store.setMcpComplete(McpOutcome.Installed, ['Claude Code']);
    // Stub integration so getRolePrompts picks the right family bucket.
    store.setFrameworkConfig(integration ?? null, null);
  }, [store, role, integration]);

  useInput((input) => {
    if (input === 'R' || input === 'r') {
      setRoleIdx((i) => (i + 1) % ROLE_CYCLE.length);
      setResetKey((k) => k + 1);
    } else if (input === 'F' || input === 'f') {
      setFamilyIdx((i) => (i + 1) % FAMILY_INTEGRATIONS.length);
      setResetKey((k) => k + 1);
    } else if (input === 'X' || input === 'x') {
      setResetKey((k) => k + 1);
    }
  });

  const familyLabel = useMemo(() => {
    if (!integration) return 'unknown';
    return integration;
  }, [integration]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text dimColor>
        R cycle role · F cycle framework · X reset verify · {'[v]'} verify ·{' '}
        {'[enter]'} skip/continue
      </Text>
      <Text dimColor>
        role={String(role)} · integration={familyLabel}
      </Text>
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        <McpSuggestedPromptsScreen key={resetKey} store={store} />
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.muted} dimColor>
          (verify polls an unreachable host — celebration only fires on
          {' [v]'}. real flow celebrates when activity_log returns a hit.)
        </Text>
      </Box>
    </Box>
  );
};
