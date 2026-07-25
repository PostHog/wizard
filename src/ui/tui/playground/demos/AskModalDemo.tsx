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
  MultiLong = 'multi-long',
  MultiDescriptions = 'multi-descriptions',
  Single = 'single',
  Grouped = 'grouped',
  Done = 'done',
}

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
  const [step, setStep] = useState<DemoStep>(DemoStep.MultiLong);
  const [results, setResults] = useState<string[]>([]);

  const advance = (result: string, next: DemoStep) => {
    setResults((prev) => [...prev, result]);
    setStep(next);
  };

  if (step === DemoStep.MultiLong) {
    return (
      <AskModal prompt="Self-driving can also watch your other tools and investigate and fix the problems they surface. Which of these do you use?">
        <PickerMenu
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
