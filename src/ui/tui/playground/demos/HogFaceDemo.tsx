/**
 * HogFaceDemo — Playground demo for the HogFace mascot.
 *
 * Top: the live animations (idle blink/wink, snoring with z's, talking).
 * Below: static reference rows for every expression, arm pose and ear glyph.
 */

import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import {
  AnimatedHogFace,
  HogFace,
  SnoringHog,
  TalkingHog,
} from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';

const Labelled = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <Box flexDirection="column" alignItems="center" marginX={2}>
    {children}
    <Box height={1} />
    <Text dimColor>{label}</Text>
  </Box>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <>
    <Box flexGrow={1} />
    <Text bold color={Colors.titleColor}>
      {title}
    </Text>
    <Box height={1} />
    <Box flexDirection="row" justifyContent="center" alignItems="flex-end">
      {children}
    </Box>
  </>
);

export const HogFaceDemo = () => (
  <Box flexDirection="column" flexGrow={1} alignItems="center">
    <Box flexGrow={1} />
    <Text bold color={Colors.accent}>
      Live
    </Text>
    <Box height={1} />
    <Box flexDirection="row" justifyContent="center" alignItems="flex-end">
      <Labelled label="idle (blink/wink)">
        <AnimatedHogFace />
      </Labelled>
      <Labelled label="snoring">
        <SnoringHog />
      </Labelled>
      <Labelled label="talking">
        <TalkingHog />
      </Labelled>
    </Box>

    <Section title="Expressions">
      <Labelled label="neutral">
        <HogFace expression="neutral" />
      </Labelled>
      <Labelled label="blink">
        <HogFace expression="blink" />
      </Labelled>
      <Labelled label="wink R">
        <HogFace expression="wink" winkEye="right" />
      </Labelled>
      <Labelled label="wink L">
        <HogFace expression="wink" winkEye="left" />
      </Labelled>
      <Labelled label="cheeky">
        <HogFace expression="cheeky" />
      </Labelled>
      <Labelled label="pout">
        <HogFace expression="pout" />
      </Labelled>
      <Labelled label="open">
        <HogFace expression="shocked" />
      </Labelled>
    </Section>

    <Section title="Arms">
      <Labelled label="none">
        <HogFace arms="none" />
      </Labelled>
      <Labelled label="out">
        <HogFace arms="out" />
      </Labelled>
      <Labelled label="left">
        <HogFace arms="left" />
      </Labelled>
      <Labelled label="right">
        <HogFace arms="right" />
      </Labelled>
    </Section>

    <Section title="Ears (pick the one closest to the eyes in your font)">
      <Labelled label="⌒ current">
        <HogFace ear="⌒" />
      </Labelled>
      <Labelled label="◠">
        <HogFace ear="◠" />
      </Labelled>
      <Labelled label="∩">
        <HogFace ear="∩" />
      </Labelled>
      <Labelled label="⌓">
        <HogFace ear="⌓" />
      </Labelled>
      <Labelled label="^">
        <HogFace ear="^" />
      </Labelled>
    </Section>

    <Box flexGrow={1} />
  </Box>
);
