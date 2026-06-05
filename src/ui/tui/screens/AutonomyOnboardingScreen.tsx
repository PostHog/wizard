import fs from 'fs';
import path from 'path';
import { Box, Text } from 'ink';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { WizardStore } from '@ui/tui/store';
import type {
  AutonomyPlan,
  AutonomyResponder,
  AutonomyScout,
} from '@lib/wizard-session';
import { Colors, Icons } from '@ui/tui/styles';
import { useFileWatcher } from '@ui/tui/hooks/file-watcher';
import {
  useKeyBindings,
  KeyMatch,
  type KeyBinding,
} from '@ui/tui/hooks/useKeyBindings';

type Row =
  | { kind: 'responder'; data: AutonomyResponder }
  | { kind: 'scout'; data: AutonomyScout };

interface PartitionedRows {
  rows: Row[];
  responders: { row: Row; idx: number }[];
  scouts: { row: Row; idx: number }[];
}

interface Props {
  store: WizardStore;
}

export const AutonomyOnboardingScreen = ({ store }: Props) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const installDir = store.session.installDir;
  const planFile = path.join(
    installDir,
    '.posthog',
    'autonomy',
    'autonomy.json',
  );
  const plan = store.session.autonomyPlan;

  useFileWatcher(planFile, (parsed) => {
    store.setAutonomyPlan(parsed as AutonomyPlan);
  });

  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!plan) return;
    const init: Record<string, boolean> = {};
    for (const r of plan.responders) init[`responder:${r.type}`] = r.enabled;
    for (const s of plan.scouts) init[`scout:${s.id}`] = true;
    setEnabled(init);
  }, [plan]);

  const { rows, responders, scouts }: PartitionedRows = useMemo(() => {
    if (!plan) return { rows: [], responders: [], scouts: [] };
    const out: Row[] = [];
    const responderEntries: { row: Row; idx: number }[] = [];
    const scoutEntries: { row: Row; idx: number }[] = [];
    plan.responders.forEach((data) => {
      const row: Row = { kind: 'responder', data };
      responderEntries.push({ row, idx: out.length });
      out.push(row);
    });
    plan.scouts.forEach((data) => {
      const row: Row = { kind: 'scout', data };
      scoutEntries.push({ row, idx: out.length });
      out.push(row);
    });
    return { rows: out, responders: responderEntries, scouts: scoutEntries };
  }, [plan]);

  const [focused, setFocused] = useState(0);
  // Synced with `focused` so a same-tick toggle reads the new value before
  // React reconciles. setState's batching can otherwise drop one of two
  // keypresses arriving in the same microtask.
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const moveFocus = (delta: number): void => {
    if (rows.length === 0) return;
    const next = (focusedRef.current + delta + rows.length) % rows.length;
    focusedRef.current = next;
    setFocused(next);
  };

  const toggleFocused = (): void => {
    const row = rows[focusedRef.current];
    if (!row) return;
    const key =
      row.kind === 'responder'
        ? `responder:${row.data.type}`
        : `scout:${row.data.id}`;
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const confirm = (): void => {
    if (plan) {
      const finalPlan: AutonomyPlan = {
        ...plan,
        responders: plan.responders.map((r) => ({
          ...r,
          enabled: enabled[`responder:${r.type}`] ?? r.enabled,
        })),
        scouts: plan.scouts.filter((s) => enabled[`scout:${s.id}`] !== false),
      };
      try {
        fs.writeFileSync(planFile, JSON.stringify(finalPlan, null, 2) + '\n');
        store.setAutonomyPlan(finalPlan);
      } catch {
        // Best-effort persistence — the agent already wrote the file once.
      }
    }
    store.setAutonomyOnboardingDismissed();
  };

  const dismissLoadError = (): void => store.setAutonomyOnboardingDismissed();

  const bindings: KeyBinding[] = [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '↑↓',
      action: 'select agent',
      handler: (_input, key) => {
        if (key.upArrow) moveFocus(-1);
        if (key.downArrow) moveFocus(1);
      },
    },
    {
      match: KeyMatch.Space,
      label: 'space',
      action: 'toggle',
      handler: () => toggleFocused(),
    },
    {
      match: KeyMatch.Return,
      label: 'enter',
      action: plan ? 'confirm plan' : 'continue',
      handler: () => (plan ? confirm() : dismissLoadError()),
    },
  ];

  useKeyBindings('autonomy-onboarding', bindings);

  if (!plan) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        padding={1}
        alignItems="center"
        justifyContent="center"
      >
        <Text dimColor>Loading autonomy plan from {planFile}…</Text>
      </Box>
    );
  }

  const counts = countEnabled(rows, enabled);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Header />
      <Box flexDirection="row" marginTop={1} flexGrow={1}>
        <Box
          flexDirection="column"
          flexGrow={1}
          marginRight={2}
          overflow="hidden"
        >
          <SectionHeader>Responders</SectionHeader>
          <Text dimColor>Reactive · one run per incoming signal.</Text>
          <Box flexDirection="column" marginTop={1}>
            {responders.map(({ row, idx }) => (
              <ResponderRow
                key={`responder:${(row.data as AutonomyResponder).type}`}
                data={row.data as AutonomyResponder}
                focused={focused === idx}
                enabled={
                  enabled[
                    `responder:${(row.data as AutonomyResponder).type}`
                  ] ?? (row.data as AutonomyResponder).enabled
                }
              />
            ))}
          </Box>

          <Box marginTop={1}>
            <SectionHeader>Scouts</SectionHeader>
          </Box>
          <Text dimColor>Scheduled · one run per cadence tick.</Text>
          <Box flexDirection="column" marginTop={1}>
            {scouts.map(({ row, idx }) => (
              <ScoutRow
                key={`scout:${(row.data as AutonomyScout).id}`}
                data={row.data as AutonomyScout}
                focused={focused === idx}
                enabled={
                  enabled[`scout:${(row.data as AutonomyScout).id}`] ?? true
                }
              />
            ))}
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {counts.scouts} scout{counts.scouts === 1 ? '' : 's'} ·{' '}
          {counts.responders} responder
          {counts.responders === 1 ? '' : 's'} will be saved to
          .posthog/autonomy/autonomy.json
        </Text>
      </Box>
    </Box>
  );
};

const Header = () => (
  <Box flexDirection="column">
    <Text bold>
      <Text color="#1D4AFF">{'█'}</Text>
      <Text color="#F54E00">{'█'}</Text>
      <Text color="#F9BD2B">{'█'}</Text> PostHog Autonomy
    </Text>
    <Text dimColor>
      A plan for self-driving agents on your product. Toggle what you want.
    </Text>
  </Box>
);

const SectionHeader = ({ children }: { children: ReactNode }) => (
  <Text bold color={Colors.accent}>
    {children}
  </Text>
);

interface RowViewProps {
  title: string;
  subtitle: string;
  rightTag: string;
  focused: boolean;
  enabled: boolean;
}

const RowView = ({
  title,
  subtitle,
  rightTag,
  focused,
  enabled,
}: RowViewProps) => {
  let titleColor: string | undefined;
  if (focused) titleColor = Colors.accent;
  else if (!enabled) titleColor = Colors.muted;

  const checkbox = enabled ? Icons.squareFilled : Icons.squareOpen;
  const indicator = focused ? Icons.triangleSmallRight : ' ';

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focused ? Colors.accent : undefined}>{indicator} </Text>
        <Text color={enabled ? '#F9BD2B' : Colors.muted}>{checkbox}</Text>
        <Text color={titleColor} bold={focused}>
          {' '}
          {truncate(title, 32)}
        </Text>
        {rightTag ? (
          <Text dimColor>
            {'  '}· {rightTag}
          </Text>
        ) : null}
      </Box>
      {subtitle ? (
        <Box marginLeft={4}>
          <Text dimColor wrap="truncate-end">
            {subtitle}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};

const ResponderRow = ({
  data,
  focused,
  enabled,
}: {
  data: AutonomyResponder;
  focused: boolean;
  enabled: boolean;
}) => (
  <RowView
    title={responderTitle(data.type)}
    subtitle={data.rationale}
    rightTag={data.trigger?.kind ? humanTrigger(data.trigger.kind) : ''}
    focused={focused}
    enabled={enabled}
  />
);

const ScoutRow = ({
  data,
  focused,
  enabled,
}: {
  data: AutonomyScout;
  focused: boolean;
  enabled: boolean;
}) => (
  <RowView
    title={data.name}
    subtitle={data.rationale || data.area}
    rightTag={data.cadence}
    focused={focused}
    enabled={enabled}
  />
);

function responderTitle(type: AutonomyResponder['type']): string {
  if (type === 'error-tracking') return 'Error Tracking responder';
  return 'Support responder';
}

function humanTrigger(
  kind: NonNullable<AutonomyResponder['trigger']>['kind'],
): string {
  const map: Record<NonNullable<AutonomyResponder['trigger']>['kind'], string> =
    {
      new_issue: 'on new issue',
      issue_reopen: 'on reopen',
      volume_spike: 'on volume spike',
      new_ticket: 'on new ticket',
    };
  return map[kind];
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function countEnabled(
  rows: Row[],
  enabled: Record<string, boolean>,
): { scouts: number; responders: number } {
  let scouts = 0;
  let responders = 0;
  for (const r of rows) {
    if (r.kind === 'scout' && enabled[`scout:${r.data.id}`] !== false)
      scouts += 1;
    if (r.kind === 'responder' && enabled[`responder:${r.data.type}`])
      responders += 1;
  }
  return { scouts, responders };
}
