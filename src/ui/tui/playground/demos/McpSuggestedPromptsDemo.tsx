/**
 * McpSuggestedPromptsDemo — Playground demo for the post-MCP
 * suggested-prompts screen.
 *
 * Mounts the real McpSuggestedPromptsScreen with mock services so every
 * phase (Choose → Authenticating → Scouting → [SeedOffer → Seeding] →
 * Greeting → PromptPicker → Running → FollowUp → Goodbye) can be previewed
 * without touching the network. The Greeting phase auto-advances; FollowUp
 * re-enters Running when a follow-up is picked, building a conversation
 * tree up to MAX_PROMPT_RUNS deep.
 *
 *   R   cycle role         (null → founder → product → ... → data → null)
 *   F   cycle framework    (null → nextjs → vue → swift → django → null)
 *   T   cycle data tier    (rich → sparse → empty) — drives the scout:
 *                          rich → generated quests from real events;
 *                          empty → seed-offer fork; sparse → safe read.
 *   X   remount the screen (useful after Exit)
 *
 *   O   OAuth outcome:     success | error
 *   L   login delay:       0ms (skip UI) | 2000ms | 6000ms
 *   S   stream script:     short-text | with-tools | mid-stream-error
 *   C   chunk delay:       50ms | 200ms | 800ms
 *
 * Tips:
 *  - Set T to "empty" to walk the seed-events fork (SeedOffer → Seeding),
 *    which lands on a rich seeded profile.
 *  - Switch S to "with-tools" and the FollowUp picker after the run will
 *    show context-aware suggestions based on the last tool (mock tool
 *    names are MCP-prefixed and pass through getFollowUps normalization).
 */

import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { McpSuggestedPromptsScreen } from '@ui/tui/screens/McpSuggestedPromptsScreen';
import { Colors } from '@ui/tui/styles';
import { Integration } from '@lib/constants';
import { McpOutcome } from '@lib/wizard-session';
import { TAILORED_ROLES } from '@lib/mcp-role-prompts';
import {
  assembleProfile,
  type ProjectDataProfile,
} from '@lib/mcp-project-profile';
import { seededProfile } from '@lib/mcp-seed-events';
import type {
  AgentChunk,
  McpSuggestedPromptsServices,
} from '@ui/tui/services/mcp-suggested-prompts-services';

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
const CHUNK_DELAYS_MS = [50, 200, 800] as const;

// Canned scout outcomes. 'rich' → generated quests from real events;
// 'sparse' → safe read + a generated quest; 'empty' → seed-offer fork.
const PROBE_TIER_CYCLE = ['rich', 'sparse', 'empty'] as const;
type ProbeTier = (typeof PROBE_TIER_CYCLE)[number];

// Every product absent, so activation cross-sells are eligible in the demo.
const NO_PRODUCTS = {
  sessionReplay: false,
  surveys: false,
  featureFlags: false,
  experiments: false,
  dataWarehouse: false,
} as const;

function mockProfile(tier: ProbeTier): ProjectDataProfile {
  if (tier === 'empty') {
    return assembleProfile([], NO_PRODUCTS);
  }
  if (tier === 'sparse') {
    return assembleProfile(
      [
        { name: '$pageview', count: 12 },
        { name: 'clicked', count: 5 },
      ],
      NO_PRODUCTS,
    );
  }
  return assembleProfile(
    [
      { name: '$pageview', count: 100 },
      { name: 'feature_used', count: 21 },
      { name: 'signed_up', count: 10 },
      { name: 'activated', count: 7 },
      { name: 'upgraded_to_paid', count: 3 },
    ],
    NO_PRODUCTS,
  );
}

type LoginOutcome = 'success' | 'error';
type StreamScript = 'short-text' | 'with-tools' | 'mid-stream-error';
const LOGIN_OUTCOMES: LoginOutcome[] = ['success', 'error'];
const STREAM_SCRIPTS: StreamScript[] = [
  'short-text',
  'with-tools',
  'mid-stream-error',
];

const SCRIPTS: Record<StreamScript, AgentChunk[]> = {
  'short-text': [
    { kind: 'text', text: 'Looking at your project…' },
    { kind: 'text', text: ' here is a quick read of the last 24 hours.' },
    {
      kind: 'text',
      text: ' You had 12,308 events from 2,144 distinct users.',
    },
    { kind: 'text', text: '\n\nNothing unusual stood out.' },
    { kind: 'done', sessionId: 'mock-session-aaa' },
  ],
  'with-tools': [
    { kind: 'text', text: 'Looking up your project…' },
    {
      kind: 'tool-call',
      toolName: 'mcp__posthog-wizard__query-trends',
      detail: '{ event: "signup", interval: "day", window: "7d" }',
    },
    {
      kind: 'tool-result',
      toolName: 'mcp__posthog-wizard__query-trends',
      detail: '{ rows: 7, total: 482, change: +8.4% }',
    },
    {
      kind: 'text',
      text: '\nSignups are up 8.4% week-over-week — 482 over the last 7 days.',
    },
    {
      kind: 'tool-call',
      toolName: 'mcp__posthog-wizard__create-insight',
      detail: '{ name: "Weekly signups", query: <trends>, save: true }',
    },
    {
      kind: 'tool-result',
      toolName: 'mcp__posthog-wizard__create-insight',
      detail:
        '{ id: "ins_abc123", url: "https://app.posthog.com/i/ins_abc123" }',
    },
    {
      kind: 'text',
      text: '\nInsight saved as "Weekly signups" — pinned to your team dashboard.',
    },
    { kind: 'done', sessionId: 'mock-session-aaa' },
  ],
  'mid-stream-error': [
    { kind: 'text', text: 'Looking at the most recent errors…' },
    {
      kind: 'tool-call',
      toolName: 'mcp__posthog-wizard__list-errors',
      detail: '{ window: "7d", limit: 5 }',
    },
    {
      kind: 'error',
      text: 'MCP server returned 503 — try again in a moment.',
    },
  ],
};

interface MockConfig {
  role: string | null;
  tier: ProbeTier;
  loginOutcome: LoginOutcome;
  loginDelayMs: number;
  script: StreamScript;
  chunkDelayMs: number;
}

interface McpSuggestedPromptsDemoProps {
  store: WizardStore;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns a McpSuggestedPromptsServices instance whose behavior is read
 * fresh from `configRef` on every call. Hotkey changes take effect on
 * the *next* invocation without remounting the screen.
 */
function createMockServices(
  store: WizardStore,
  configRef: { current: MockConfig },
): McpSuggestedPromptsServices {
  return {
    performLogin: async () => {
      const cfg = configRef.current;
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
        user: {
          distinct_id: 'demo-distinct-id',
          uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          id: 1,
          email: 'joe@demo.example.com',
          first_name: 'Joe',
          last_name: 'Demo',
          role_at_organization: cfg.role,
          team: {
            id: 1,
            uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            organization: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            api_token: 'phc_mock',
            project_id: 1,
            name: 'Demo team',
            timezone: 'UTC',
          },
          organization: {
            id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            name: 'Demo org',
            slug: 'demo-org',
            membership_level: 1,
          },
          organizations: [
            {
              id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
              name: 'Demo org',
              membership_level: 1,
            },
          ],
        },
      };
    },

    runPromptStreaming: ({ signal }) => mockStream(configRef, signal),

    probeProjectData: async () => {
      // Brief delay so the Scouting spinner is visible.
      await delay(800);
      return mockProfile(configRef.current.tier);
    },

    seedDemoEvents: async ({ baseProfile }) => {
      // No real ingestion in the playground — just show the spinner and
      // return the same seeded profile the production seeder would yield.
      await delay(1500);
      return seededProfile(baseProfile, new Date());
    },
  };
}

async function* mockStream(
  configRef: { current: MockConfig },
  signal: AbortSignal,
): AsyncIterable<AgentChunk> {
  const cfg = configRef.current;
  const chunks = SCRIPTS[cfg.script];
  for (const chunk of chunks) {
    if (signal.aborted) return;
    await delay(cfg.chunkDelayMs);
    if (signal.aborted) return;
    yield chunk;
  }
}

export const McpSuggestedPromptsDemo = ({
  store,
}: McpSuggestedPromptsDemoProps) => {
  const [roleIdx, setRoleIdx] = useState(2); // 'product' — has overrides
  const [familyIdx, setFamilyIdx] = useState(1); // nextjs (fullstack)
  const [tierIdx, setTierIdx] = useState(0); // 'rich' — shows generated quests
  const [resetKey, setResetKey] = useState(0);
  const [loginOutcomeIdx, setLoginOutcomeIdx] = useState(0);
  const [loginDelayIdx, setLoginDelayIdx] = useState(1); // 2000ms default
  const [scriptIdx, setScriptIdx] = useState(1); // 'with-tools' default
  const [chunkDelayIdx, setChunkDelayIdx] = useState(1); // 200ms default

  const role = ROLE_CYCLE[roleIdx];
  const integration = FAMILY_INTEGRATIONS[familyIdx];
  const tier = PROBE_TIER_CYCLE[tierIdx];
  const loginOutcome = LOGIN_OUTCOMES[loginOutcomeIdx];
  const loginDelayMs = LOGIN_DELAYS_MS[loginDelayIdx];
  const script = STREAM_SCRIPTS[scriptIdx];
  const chunkDelayMs = CHUNK_DELAYS_MS[chunkDelayIdx];

  // Ref-based config so hotkeys can update behavior without remounting.
  const configRef = useRef<MockConfig>({
    role,
    tier,
    loginOutcome,
    loginDelayMs,
    script,
    chunkDelayMs,
  });
  configRef.current = {
    role,
    tier,
    loginOutcome,
    loginDelayMs,
    script,
    chunkDelayMs,
  };

  // Stable services instance — reads from configRef each call.
  const services = useMemo(() => createMockServices(store, configRef), [store]);

  // Seed framework + a fake "installed" MCP state. setMcpComplete here
  // is harmless — production would have set it from the McpScreen step
  // before this screen mounts.
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
    } else if (input === 'T' || input === 't') {
      // Remount so the new tier is re-probed from the Scouting phase.
      setTierIdx((i) => (i + 1) % PROBE_TIER_CYCLE.length);
      setResetKey((k) => k + 1);
    } else if (input === 'X' || input === 'x') {
      store.setCredentials(null);
      store.setRoleAtOrganization(null);
      setResetKey((k) => k + 1);
    } else if (input === 'O' || input === 'o') {
      setLoginOutcomeIdx((i) => (i + 1) % LOGIN_OUTCOMES.length);
    } else if (input === 'L' || input === 'l') {
      setLoginDelayIdx((i) => (i + 1) % LOGIN_DELAYS_MS.length);
    } else if (input === 'S' || input === 's') {
      setScriptIdx((i) => (i + 1) % STREAM_SCRIPTS.length);
    } else if (input === 'C' || input === 'c') {
      setChunkDelayIdx((i) => (i + 1) % CHUNK_DELAYS_MS.length);
    }
  });

  const familyLabel = integration ?? 'unknown';

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text dimColor>
        R role · F framework · T data-tier · X reset · O oauth · L login-delay ·
        S script · C chunk-delay
      </Text>
      <Text dimColor>
        role={String(role)} · integration={familyLabel} · tier={tier} · login=
        {loginOutcome}/{loginDelayMs}ms · script={script}/{chunkDelayMs}ms
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
          (mock services — no real OAuth, no real LLM. Press R/F to preview
          different prompt kits; O/L/S/C to flip mock outcomes.)
        </Text>
      </Box>
    </Box>
  );
};
