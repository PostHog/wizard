/**
 * KeyboardHintsDemo — Demonstrates the KeyboardHintsBar with all input types.
 *
 * Cycles through SinglePicker, MultiPicker, GroupedPicker, and Confirmation
 * so the user can see the hints bar update automatically for each component.
 * The bar appears at the bottom of the screen and dismisses 3s after the
 * first keypress, then reappears when the component changes.
 */

import { Box, Text } from 'ink';
import { useState, type ReactNode } from 'react';
import {
  PickerMenu,
  GroupedPickerMenu,
  ConfirmationInput,
} from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';

enum DemoStep {
  SingleSelect = 'single',
  MultiSelect = 'multi',
  GroupedSelect = 'grouped',
  Confirmation = 'confirm',
  Done = 'done',
}

const STEP_LABELS: Record<DemoStep, string> = {
  [DemoStep.SingleSelect]: 'Single Select — hints: ↑↓ navigate, enter select',
  [DemoStep.MultiSelect]:
    'Multi Select — hints: ↑↓ navigate, space toggle, enter confirm',
  [DemoStep.GroupedSelect]:
    'Grouped Select — hints: ↑↓ navigate, space toggle, a toggle all, enter confirm',
  [DemoStep.Confirmation]:
    'Confirmation — hints: ←→ switch, enter confirm, esc cancel',
  [DemoStep.Done]: 'Done',
};

export const KeyboardHintsDemo = () => {
  const [step, setStep] = useState<DemoStep>(DemoStep.SingleSelect);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => setLog((prev) => [...prev.slice(-4), msg]);

  if (step === DemoStep.SingleSelect) {
    return (
      <Wrapper step={step} log={log}>
        <PickerMenu
          message="Pick a framework"
          options={[
            { label: 'Next.js', value: 'next' },
            { label: 'React', value: 'react' },
            { label: 'Vue', value: 'vue' },
            { label: 'Svelte', value: 'svelte' },
          ]}
          columns={2}
          onSelect={(v) => {
            addLog(`Single: ${String(v)}`);
            setStep(DemoStep.MultiSelect);
          }}
        />
      </Wrapper>
    );
  }

  if (step === DemoStep.MultiSelect) {
    return (
      <Wrapper step={step} log={log}>
        <PickerMenu
          message="Pick features to enable"
          mode="multi"
          options={[
            { label: 'Analytics', value: 'analytics' },
            { label: 'Session Replay', value: 'replay' },
            { label: 'Feature Flags', value: 'flags' },
            { label: 'Surveys', value: 'surveys' },
          ]}
          onSelect={(values) => {
            const arr = Array.isArray(values) ? values : [values];
            addLog(`Multi: ${arr.join(', ')}`);
            setStep(DemoStep.GroupedSelect);
          }}
        />
      </Wrapper>
    );
  }

  if (step === DemoStep.GroupedSelect) {
    return (
      <Wrapper step={step} log={log}>
        <GroupedPickerMenu
          message="Select integrations"
          groups={{
            Frontend: [
              { label: 'React SDK', value: 'react-sdk' },
              { label: 'Web Analytics', value: 'web-analytics' },
            ],
            Backend: [
              { label: 'Node SDK', value: 'node-sdk' },
              { label: 'Python SDK', value: 'python-sdk' },
            ],
            Tooling: [
              { label: 'MCP Server', value: 'mcp' },
              { label: 'CLI', value: 'cli' },
            ],
          }}
          onSelect={(values) => {
            addLog(`Grouped: ${values.join(', ')}`);
            setStep(DemoStep.Confirmation);
          }}
        />
      </Wrapper>
    );
  }

  if (step === DemoStep.Confirmation) {
    return (
      <Wrapper step={step} log={log}>
        <ConfirmationInput
          message="Apply these settings?"
          onConfirm={() => {
            addLog('Confirmed!');
            setStep(DemoStep.Done);
          }}
          onCancel={() => {
            addLog('Cancelled');
            setStep(DemoStep.Done);
          }}
        />
      </Wrapper>
    );
  }

  return (
    <Wrapper step={step} log={log}>
      <Text dimColor>
        All steps complete. Switch away from this tab and back to restart.
      </Text>
    </Wrapper>
  );
};

const Wrapper = ({
  step,
  log,
  children,
}: {
  step: DemoStep;
  log: string[];
  children: ReactNode;
}) => (
  <Box flexDirection="column">
    <Text bold color={Colors.accent}>
      Keyboard Hints Demo
    </Text>
    <Text dimColor>{STEP_LABELS[step]}</Text>
    <Box height={1} />
    {children}
    {log.length > 0 && (
      <>
        <Box height={1} />
        <Text dimColor>Log:</Text>
        {log.map((entry, i) => (
          <Text key={i} color={Colors.muted}>
            {' '}
            {entry}
          </Text>
        ))}
      </>
    )}
  </Box>
);
