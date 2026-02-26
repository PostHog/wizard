/**
 * InputDemo — Demonstrates PickerMenu (single + multi) and ConfirmationInput.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { PickerMenu, ConfirmationInput } from '../../primitives/index.js';
import { Colors } from '../../styles.js';

type DemoStep = 'single' | 'multi' | 'confirm' | 'done';

export const InputDemo = () => {
  const [step, setStep] = useState<DemoStep>('single');
  const [results, setResults] = useState<string[]>([]);

  if (step === 'single') {
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
            setStep('multi');
          }}
        />
      </Box>
    );
  }

  if (step === 'multi') {
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
            setStep('confirm');
          }}
        />
      </Box>
    );
  }

  if (step === 'confirm') {
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
            setStep('done');
          }}
          onCancel={() => {
            setResults((prev) => [...prev, 'Confirmed: No']);
            setStep('done');
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
