/**
 * McpSuggestedPromptsDemo — Playground demo for the post-MCP
 * suggested-prompts screen.
 *
 * Mounts the real McpSuggestedPromptsScreen with mock services so every
 * phase (Choose → Authenticating → Verifying → Celebrated/TimedOut) can
 * be previewed without touching the network. No special-case branches
 * in the screen itself — the mock just satisfies the same interface
 * production wires.
 *
 *   R   cycle role         (null → founder → product → ... → data → null)
 *   F   cycle framework    (null → nextjs → vue → swift → django → null)
 *   X   remount the screen (useful after Exit)
 *
 *   O   OAuth outcome:     success | error
 *   L   login delay:       0ms (skip UI) | 2000ms | 6000ms
 *   A   activity outcome:  hit | none | error
 *   D   activity delay:    100ms | 1500ms | 6000ms
 */

import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { McpSuggestedPromptsScreen } from '@ui/tui/screens/McpSuggestedPromptsScreen';
import { Colors } from '@ui/tui/styles';
import { Integration } from '@lib/constants';
import { McpOutcome } from '@lib/wizard-session';
import { TAILORED_ROLES } from '@lib/mcp-role-prompts';
import type { McpSuggestedPromptsServices } from '@ui/tui/services/mcp-suggested-prompts-services';
import type { ActivityLogEntry } from '@lib/api';

// One Integration per framework family so cycling exercises every
// override bucket in mcp-role-prompts.ts.
const FAMILY_INTEGRATIONS: Array<Integration | null> = [
  null,
  Integration.nextjs, // fullstack
  Integration.vue, // frontend-web
  Integration.swift, // mobile
  Integration.django, // backend
];

const ROLE_CYCLE: Array<string | null> = [null, ...TAILORED_ROLES];

const LOGIN_DELAYS_MS = [0, 2000, 6000] as const;
const ACTIVITY_DELAYS_MS = [100, 1500, 6000] as const;
type LoginOutcome = 'success' | 'error';
type ActivityOutcome = 'hit' | 'none' | 'error';
const LOGIN_OUTCOMES: LoginOutcome[] = ['success', 'error'];
const ACTIVITY_OUTCOMES: ActivityOutcome[] = ['hit', 'none', 'error'];

interface MockConfig {
  role: string | null;
  loginOutcome: LoginOutcome;
  loginDelayMs: number;
  activityOutcome: ActivityOutcome;
  activityDelayMs: number;
}

interface McpSuggestedPromptsDemoProps {
  store: WizardStore;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns a McpSuggestedPromptsServices instance whose behavior is read
 * fresh from `configRef` on every call. This lets hotkey changes take
 * effect for the *next* invocation without remounting the screen.
 */
function createMockServices(
  store: WizardStore,
  configRef: { current: MockConfig },
): McpSuggestedPromptsServices {
  return {
    performLogin: async () => {
      const cfg = configRef.current;
      // Set a mock login URL so the spinner + URL layout renders when
      // there's enough delay to actually see it. Cleared when login
      // resolves (the screen also clears it on success).
      store.setLoginUrl('https://app.posthog.com/oauth/playground-mock');
      await delay(cfg.loginDelayMs);
      store.setLoginUrl(null);

      if (cfg.loginOutcome === 'error') {
        throw new Error('Mock OAuth rejected — exercising error path.');
      }

      return {
        credentials: {
          accessToken: 'phx_mock',
          projectApiKey: 'phc_mock',
          host: 'http://127.0.0.1:1',
          projectId: 1,
        },
        roleAtOrganization: cfg.role,
      };
    },

    fetchActivitySince: async ({ since }) => {
      const cfg = configRef.current;
      await delay(cfg.activityDelayMs);

      if (cfg.activityOutcome === 'error') {
        // Production swallows errors and returns [] — mirror that here.
        return [];
      }
      if (cfg.activityOutcome === 'hit') {
        const entry: ActivityLogEntry = {
          scope: 'Annotation',
          activity: 'created',
          created_at: new Date(since.getTime() + 1).toISOString(),
        };
        return [entry];
      }
      // 'none' — flows to TimedOut after the screen's 30s window.
      return [];
    },
  };
}

export const McpSuggestedPromptsDemo = ({
  store,
}: McpSuggestedPromptsDemoProps) => {
  const [roleIdx, setRoleIdx] = useState(2); // 'product' — has overrides
  const [familyIdx, setFamilyIdx] = useState(1); // nextjs (fullstack)
  const [resetKey, setResetKey] = useState(0);
  const [loginOutcomeIdx, setLoginOutcomeIdx] = useState(0);
  const [loginDelayIdx, setLoginDelayIdx] = useState(1); // 2000ms default
  const [activityOutcomeIdx, setActivityOutcomeIdx] = useState(0); // 'hit'
  const [activityDelayIdx, setActivityDelayIdx] = useState(0); // 100ms

  const role = ROLE_CYCLE[roleIdx];
  const integration = FAMILY_INTEGRATIONS[familyIdx];
  const loginOutcome = LOGIN_OUTCOMES[loginOutcomeIdx];
  const loginDelayMs = LOGIN_DELAYS_MS[loginDelayIdx];
  const activityOutcome = ACTIVITY_OUTCOMES[activityOutcomeIdx];
  const activityDelayMs = ACTIVITY_DELAYS_MS[activityDelayIdx];

  // Ref-based config so hotkeys can update behavior without remounting.
  const configRef = useRef<MockConfig>({
    role,
    loginOutcome,
    loginDelayMs,
    activityOutcome,
    activityDelayMs,
  });
  configRef.current = {
    role,
    loginOutcome,
    loginDelayMs,
    activityOutcome,
    activityDelayMs,
  };

  // Stable services instance — reads from configRef each call.
  const services = useMemo(() => createMockServices(store, configRef), [store]);

  // Seed framework + a fake "installed" MCP state so the screen's verify
  // copy can name a client. We deliberately do NOT pre-set credentials —
  // credentials must come from the mock performLogin() so the Choose
  // phase is reachable. setMcpComplete here is harmless: in production
  // the McpScreen step would have already set it before this screen
  // mounts.
  useEffect(() => {
    store.setMcpComplete(McpOutcome.Installed, ['Claude Code']);
    store.setFrameworkConfig(integration ?? null, null);
  }, [store, integration]);

  useInput((input) => {
    if (input === 'R' || input === 'r') {
      setRoleIdx((i) => (i + 1) % ROLE_CYCLE.length);
      setResetKey((k) => k + 1);
    } else if (input === 'F' || input === 'f') {
      setFamilyIdx((i) => (i + 1) % FAMILY_INTEGRATIONS.length);
      setResetKey((k) => k + 1);
    } else if (input === 'X' || input === 'x') {
      // Clear any lingering store state from a previous run, then
      // remount the screen so it lands back on Choose.
      store.setCredentials(null);
      store.setRoleAtOrganization(null);
      setResetKey((k) => k + 1);
    } else if (input === 'O' || input === 'o') {
      setLoginOutcomeIdx((i) => (i + 1) % LOGIN_OUTCOMES.length);
    } else if (input === 'L' || input === 'l') {
      setLoginDelayIdx((i) => (i + 1) % LOGIN_DELAYS_MS.length);
    } else if (input === 'A' || input === 'a') {
      setActivityOutcomeIdx((i) => (i + 1) % ACTIVITY_OUTCOMES.length);
    } else if (input === 'D' || input === 'd') {
      setActivityDelayIdx((i) => (i + 1) % ACTIVITY_DELAYS_MS.length);
    }
  });

  const familyLabel = integration ?? 'unknown';

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text dimColor>
        R role · F framework · X reset · O oauth · L login-delay · A activity ·
        D activity-delay
      </Text>
      <Text dimColor>
        role={String(role)} · integration={familyLabel} · login=
        {loginOutcome}/{loginDelayMs}ms · activity={activityOutcome}/
        {activityDelayMs}ms
      </Text>
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        <McpSuggestedPromptsScreen
          key={resetKey}
          store={store}
          services={services}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.muted} dimColor>
          (mock services — no real OAuth, no real activity_log. Press R/F to
          preview different prompt kits; O/L/A/D to flip mock outcomes.)
        </Text>
      </Box>
    </Box>
  );
};
