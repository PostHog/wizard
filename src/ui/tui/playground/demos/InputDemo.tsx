/**
 * InputDemo — Demonstrates PickerMenu (single + multi) and ConfirmationInput.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { PickerMenu, ConfirmationInput } from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';

enum DemoStep {
  Single = 'single',
  Multi = 'multi',
  MultiLong = 'multi-long',
  Confirm = 'confirm',
  Done = 'done',
}

// A long single-column multi-select — more options than a normal terminal can
// show at once — so the playground exercises PickerMenu's viewport scrolling
// (the "↑/↓ N more" indicators and cursor-following window).
const LONG_OPTIONS = [
  'None of these',
  'GitHub Issues',
  'Linear',
  'Jira',
  'GitLab',
  'Gitea',
  'Shortcut',
  'Sentry',
  'Rollbar',
  'Bugsnag',
  'Honeybadger',
  'Raygun',
  'Zendesk',
  'Freshdesk',
  'Freshservice',
  'Front',
  'Gorgias',
  'Kustomer',
  'Dixa',
  'Plain',
  'pganalyze',
  'Snyk',
  'SonarQube',
  'Semgrep',
  'Rapid7 InsightVM',
  'Featurebase',
  'Frill',
  'Aha',
  'UserVoice',
  'Productboard',
  'Canny',
  'AskNicely',
  'Retently',
  'Appfigures',
  'AppFollow',
  'Judge.me',
  'Google Search Console',
].map((label) => ({ label, value: label.toLowerCase().replace(/\s+/g, '-') }));

export const InputDemo = () => {
  const [step, setStep] = useState<DemoStep>(DemoStep.Single);
  const [results, setResults] = useState<string[]>([]);

  if (step === DemoStep.Single) {
    return (
      <Box flexDirection="column">
        <Text bold color={Colors.accent}>
          Input Demo — Single Select
        </Text>
        <Box height={1} />
        <PickerMenu
          message="Pick a color"
          options={[
            { label: 'Red', value: 'red', hint: 'warm' },
            { label: 'Blue', value: 'blue', hint: 'cool' },
            { label: 'Green', value: 'green', hint: 'natural' },
          ]}
          onSelect={(value) => {
            setResults((prev) => [...prev, `Single: ${value}`]);
            setStep(DemoStep.Multi);
          }}
        />
      </Box>
    );
  }

  if (step === DemoStep.Multi) {
    return (
      <Box flexDirection="column">
        <Text bold color={Colors.accent}>
          Input Demo — Multi Select
        </Text>
        <Box height={1} />
        <PickerMenu
          message="Pick toppings"
          mode="multi"
          options={[
            { label: 'Cheese', value: 'cheese' },
            { label: 'Pepperoni', value: 'pepperoni' },
            { label: 'Mushrooms', value: 'mushrooms' },
            { label: 'Onions', value: 'onions' },
          ]}
          onSelect={(values) => {
            const arr = Array.isArray(values) ? values : [values];
            setResults((prev) => [...prev, `Multi: ${arr.join(', ')}`]);
            setStep(DemoStep.MultiLong);
          }}
        />
      </Box>
    );
  }

  if (step === DemoStep.MultiLong) {
    return (
      <Box flexDirection="column">
        <Text bold color={Colors.accent}>
          Input Demo — Multi Select (long, scrolls)
        </Text>
        <Box height={1} />
        <PickerMenu
          message="Which of these do you use? (↑/↓ to scroll)"
          mode="multi"
          options={LONG_OPTIONS}
          onSelect={(values) => {
            const arr = Array.isArray(values) ? values : [values];
            setResults((prev) => [
              ...prev,
              `Multi (long): ${arr.length} picked`,
            ]);
            setStep(DemoStep.Confirm);
          }}
        />
      </Box>
    );
  }

  if (step === DemoStep.Confirm) {
    return (
      <Box flexDirection="column">
        <Text bold color={Colors.accent}>
          Input Demo — Confirmation
        </Text>
        <Box height={1} />
        <ConfirmationInput
          message="Are you satisfied with your choices?"
          onConfirm={() => {
            setResults((prev) => [...prev, 'Confirmed: Yes']);
            setStep(DemoStep.Done);
          }}
          onCancel={() => {
            setResults((prev) => [...prev, 'Confirmed: No']);
            setStep(DemoStep.Done);
          }}
        />
      </Box>
    );
  }

  // done
  return (
    <Box flexDirection="column">
      <Text bold color={Colors.accent}>
        Input Demo — Results
      </Text>
      <Box height={1} />
      {results.map((r, i) => (
        <Text key={i} color={Colors.success}>
          {'\u2714'} {r}
        </Text>
      ))}
      <Box height={1} />
      <Text dimColor>Switch away from this tab and back to restart.</Text>
    </Box>
  );
};
