/**
 * AskModalDemo — Pickers rendered inside an ask-style ModalOverlay, the way
 * WizardAskScreen composes them: prompt paragraph in the modal body, then a
 * label-less PickerMenu. Exercises the viewport height cap (MAX_LIST_ROWS)
 * and the no-label spacing (no stray blank lines under the paragraph).
 */

import { Box, Text } from 'ink';
import { useState, type ReactNode } from 'react';
import {
  ModalOverlay,
  PickerMenu,
  GroupedPickerMenu,
} from '@ui/tui/primitives/index';
import { Colors, Icons } from '@ui/tui/styles';
import { LONG_OPTIONS } from './InputDemo.js';

enum DemoStep {
  ScoutRepro = 'scout-repro',
  CountLabel100 = 'count-label-100',
  CountLabel10 = 'count-label-10',
  CountLabel2 = 'count-label-2',
  CountLabel1 = 'count-label-1',
  CountDesc100 = 'count-desc-100',
  CountDesc10 = 'count-desc-10',
  CountDesc2 = 'count-desc-2',
  CountDesc1 = 'count-desc-1',
  MultiLong = 'multi-long',
  MultiDescriptions = 'multi-descriptions',
  Single = 'single',
  Grouped = 'grouped',
  Done = 'done',
}

/**
 * Counts we step through to exercise PickerMenu paging at the edges: a long
 * list that obviously pages, a just-past-the-cap list, and the degenerate
 * 1–2 item cases that (with tall rows) can still split into multiple pages.
 */

/** Label-only options at a given count, e.g. "Option 1" ... "Option 100". */
const countLabelOptions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    label: `Option ${i + 1}`,
    value: `opt-${i + 1}`,
  }));

/**
 * Options at a given count, each carrying a wrapping description so the row
 * is tall (label + ~3 wrapped lines). This is the configuration that drives
 * `rowCost` high enough to trip the multi-page bug on 1–2 item lists.
 */
const countDescOptions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    label: `Option ${i + 1}`,
    value: `opt-${i + 1}`,
    description:
      'A longer description that wraps onto multiple lines so each option row costs several terminal rows, exercising the viewport cap and the paging math at small counts.',
  }));

/**
 * Repro of the self-driving-setup scout-proposal ask that paged 3 described
 * options one per page on a short terminal ("↓ 2 more [N] for next page").
 * With the MIN_COUNT_TO_PAGE fix, all three render on one page at any height.
 */
const SCOUT_REPRO_OPTIONS = [
  {
    label: 'None — keep the built-in troop',
    value: 'none',
    description:
      'Skip custom scouts; the built-in troop already covers this project well enough, and adding more scheduled checks would mostly duplicate the coverage you already get out of the box.',
  },
  {
    label: 'Playground snapshot drift scout',
    value: 'snapshot-drift',
    description:
      'Watches CI snapshot runs and flags visual drift in the playground demos before it reaches a release, so a rendering regression in a picker or overlay never ships to users unnoticed.',
  },
  {
    label: 'Benchmark regression scout',
    value: 'benchmark',
    description:
      'Tracks wizard-benchmark timings week over week and opens an issue when a run regresses past the recorded baseline, catching slow drift in agent latency before customers feel it.',
  },
];

const DESCRIBED_OPTIONS = [
  {
    label: 'Session replay',
    value: 'replay',
    description:
      'Record and replay real user sessions to see exactly what happened before an error or a rage click.',
  },
  {
    label: 'Feature flags',
    value: 'flags',
    description:
      'Roll features out gradually, target by cohort, and kill misbehaving code paths without a deploy.',
  },
  {
    label: 'Error tracking',
    value: 'errors',
    description: 'Capture exceptions with stack traces and source maps.',
  },
];

const GROUPED = {
  'Issue trackers': [
    { label: 'GitHub Issues', value: 'github' },
    { label: 'Linear', value: 'linear' },
    { label: 'Jira', value: 'jira' },
    { label: 'Shortcut', value: 'shortcut' },
  ],
  'Error monitoring': [
    { label: 'Sentry', value: 'sentry' },
    { label: 'Rollbar', value: 'rollbar' },
    { label: 'Bugsnag', value: 'bugsnag' },
    { label: 'Honeybadger', value: 'honeybadger' },
  ],
  'Support desks': [
    { label: 'Zendesk', value: 'zendesk' },
    { label: 'Freshdesk', value: 'freshdesk' },
    { label: 'Front', value: 'front' },
    { label: 'Intercom', value: 'intercom' },
  ],
  Observability: [
    { label: 'Datadog', value: 'datadog' },
    { label: 'New Relic', value: 'newrelic' },
    { label: 'Grafana', value: 'grafana' },
    { label: 'Splunk', value: 'splunk' },
  ],
};

/** Mirrors WizardAskScreen's shape: paragraph body, then a label-less input. */
const AskModal = ({
  prompt,
  children,
}: {
  prompt: string;
  children: ReactNode;
}) => (
  <ModalOverlay
    borderColor={Colors.accent}
    title={`${Icons.diamond} self-driving-setup`}
    titleColor={Colors.accent}
    width={72}
  >
    <Box flexDirection="column">
      <Text>{prompt}</Text>
    </Box>
    <Box marginTop={1}>{children}</Box>
  </ModalOverlay>
);

export const AskModalDemo = () => {
  const [step, setStep] = useState<DemoStep>(DemoStep.ScoutRepro);
  const [results, setResults] = useState<string[]>([]);

  const advance = (result: string, next: DemoStep) => {
    setResults((prev) => [...prev, result]);
    setStep(next);
  };

  const countLabelSteps: Partial<
    Record<DemoStep, { next: DemoStep; count: number }>
  > = {
    [DemoStep.CountLabel100]: {
      next: DemoStep.CountLabel10,
      count: 100,
    },
    [DemoStep.CountLabel10]: { next: DemoStep.CountLabel2, count: 10 },
    [DemoStep.CountLabel2]: { next: DemoStep.CountLabel1, count: 2 },
    [DemoStep.CountLabel1]: { next: DemoStep.CountDesc100, count: 1 },
  };

  const countDescSteps: Partial<
    Record<DemoStep, { next: DemoStep; count: number }>
  > = {
    [DemoStep.CountDesc100]: { next: DemoStep.CountDesc10, count: 100 },
    [DemoStep.CountDesc10]: { next: DemoStep.CountDesc2, count: 10 },
    [DemoStep.CountDesc2]: { next: DemoStep.CountDesc1, count: 2 },
    [DemoStep.CountDesc1]: { next: DemoStep.MultiLong, count: 1 },
  };

  if (step === DemoStep.ScoutRepro) {
    return (
      <AskModal prompt="Scouts are scheduled checks that watch your data and flag issues for your inbox. Based on your repo I found two gaps the built-in troop doesn't cover — add one, both, or none. (Repro: 3 described options must stay on ONE page even in a short terminal.)">
        <PickerMenu
          key={step}
          mode="multi"
          optionMarginBottom={1}
          options={SCOUT_REPRO_OPTIONS}
          onSelect={(values) => {
            const arr = Array.isArray(values) ? values : [values];
            advance(
              `Scout repro: ${arr.length} picked`,
              DemoStep.CountLabel100,
            );
          }}
        />
      </AskModal>
    );
  }

  const labelStep = countLabelSteps[step];
  if (labelStep) {
    const { count, next } = labelStep;
    return (
      <AskModal
        prompt={`Multi-select — ${count} label-only option${
          count === 1 ? '' : 's'
        }. Watch whether ${
          count <= 2 ? 'this tiny list still pages' : 'paging kicks in'
        }.`}
      >
        <PickerMenu
          key={step}
          mode="multi"
          options={countLabelOptions(count)}
          onSelect={(values) => {
            const arr = Array.isArray(values) ? values : [values];
            advance(`Count label (${count}): ${arr.length} picked`, next);
          }}
        />
      </AskModal>
    );
  }

  const descStep = countDescSteps[step];
  if (descStep) {
    const { count, next } = descStep;
    return (
      <AskModal
        prompt={`Multi-select — ${count} option${
          count === 1 ? '' : 's'
        } with wrapping descriptions (tall rows). ${
          count <= 2
            ? 'This is where a tiny list can still split into multiple pages.'
            : ''
        }`}
      >
        <PickerMenu
          key={step}
          mode="multi"
          optionMarginBottom={1}
          options={countDescOptions(count)}
          onSelect={(values) => {
            const arr = Array.isArray(values) ? values : [values];
            advance(`Count desc (${count}): ${arr.length} picked`, next);
          }}
        />
      </AskModal>
    );
  }

  if (step === DemoStep.MultiLong) {
    return (
      <AskModal prompt="Self-driving can also watch your other tools and investigate and fix the problems they surface. Which of these do you use?">
        <PickerMenu
          key={step}
          mode="multi"
          options={LONG_OPTIONS}
          onSelect={(values) => {
            const arr = Array.isArray(values) ? values : [values];
            advance(
              `Multi (long): ${arr.length} picked`,
              DemoStep.MultiDescriptions,
            );
          }}
        />
      </AskModal>
    );
  }

  if (step === DemoStep.MultiDescriptions) {
    return (
      <AskModal prompt="Besides analytics, which PostHog products should the agent set up while it's in the codebase?">
        <PickerMenu
          key={step}
          mode="multi"
          optionMarginBottom={1}
          options={DESCRIBED_OPTIONS}
          onSelect={(values) => {
            const arr = Array.isArray(values) ? values : [values];
            advance(
              `Multi (descriptions): ${arr.join(', ') || 'none'}`,
              DemoStep.Single,
            );
          }}
        />
      </AskModal>
    );
  }

  if (step === DemoStep.Single) {
    return (
      <AskModal prompt="Your project has both an app and a marketing site. Which one should the agent instrument first?">
        <PickerMenu<string>
          options={[
            { label: 'The app', value: 'app', hint: 'src/app' },
            { label: 'The marketing site', value: 'marketing', hint: 'www/' },
            { label: 'Both, app first', value: 'both' },
          ]}
          onSelect={(value) => {
            advance(`Single: ${String(value)}`, DemoStep.Grouped);
          }}
        />
      </AskModal>
    );
  }

  if (step === DemoStep.Grouped) {
    return (
      <AskModal prompt="Grouped variant of the same ask — categories with headers, everything pre-selected:">
        <GroupedPickerMenu
          groups={GROUPED}
          onSelect={(values) => {
            advance(`Grouped: ${values.length} kept`, DemoStep.Done);
          }}
        />
      </AskModal>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.accent}>
        Ask Modal Demo — Results
      </Text>
      <Box height={1} />
      {results.map((r, i) => (
        <Text key={i} color={Colors.success}>
          {'✔'} {r}
        </Text>
      ))}
      <Box height={1} />
      <Text dimColor>Switch away from this tab and back to restart.</Text>
    </Box>
  );
};
