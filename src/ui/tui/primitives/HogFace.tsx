/**
 * HogFace — the ASCII hog mascot, rendered as terminal text.
 *
 * Two lines: an ear row (⌒ ⌒) above a face row (|•ﻌ•|). Eyes switch between
 * open (•) and shut (-); the mouth switches between the snout (ﻌ), a grin (ᴗ),
 * a pout (ε) and an open mouth (o). Arms (⊂ ⊃) can be added out to the sides
 * or swung left/right.
 *
 * The snout character ﻌ (U+FECC, an Arabic letter) is right-to-left, which
 * can reorder neighbouring characters in bidi-aware terminals — flipping the
 * eyes on a wink. To stay deterministic we render every glyph in its own
 * cell inside a flex row, so visual order always matches logical order.
 *
 * `HogFace` is a pure primitive (props in, JSX out). The animated wrappers
 * (`AnimatedHogFace`, `SnoringHog`, `TalkingHog`) add self-contained timers.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef } from 'react';
import { Colors } from '@ui/tui/styles';

export type HogExpression =
  | 'neutral'
  | 'blink'
  | 'wink'
  | 'cheeky'
  | 'pout'
  | 'shocked'
  | 'snoring';
/** Which eye closes on a wink. */
export type WinkEye = 'left' | 'right';
/** Arm pose: tucked away, out to both sides, or swung left/right. */
export type HogArms = 'none' | 'out' | 'left' | 'right';

const EAR = '⌒'; // ear arc
const SNOUT = 'ﻌ'; // closed snout (neutral mouth)
const MOUTH_GRIN = 'ᴗ'; // cheeky
const MOUTH_POUT = 'ε'; // pout
const MOUTH_OPEN = 'o'; // shocked / open / mid-speech
const EYE_OPEN = '•';
const EYE_SHUT = '-';
const BAR = '|';
const ARM_L = '⊂'; // arm reaching left
const ARM_R = '⊃'; // arm reaching right

/** Maps a named expression to its eye and mouth glyphs. */
function faceSpec(
  expression: HogExpression,
  winkEye: WinkEye,
): { eyes: [string, string]; mouth: string } {
  switch (expression) {
    case 'blink':
      return { eyes: [EYE_SHUT, EYE_SHUT], mouth: SNOUT };
    case 'wink':
      return {
        eyes: winkEye === 'left' ? [EYE_SHUT, EYE_OPEN] : [EYE_OPEN, EYE_SHUT],
        mouth: SNOUT,
      };
    case 'cheeky':
      return { eyes: [EYE_OPEN, EYE_OPEN], mouth: MOUTH_GRIN };
    case 'pout':
      return { eyes: [EYE_OPEN, EYE_OPEN], mouth: MOUTH_POUT };
    case 'shocked':
      return { eyes: [EYE_OPEN, EYE_OPEN], mouth: MOUTH_OPEN };
    case 'snoring':
      return { eyes: [EYE_SHUT, EYE_SHUT], mouth: MOUTH_OPEN };
    case 'neutral':
    default:
      return { eyes: [EYE_OPEN, EYE_OPEN], mouth: SNOUT };
  }
}

/**
 * Builds the face row glyphs and the column indices of the two eyes (so the
 * ears can be aligned over them whatever the arm pose).
 */
function buildFace(
  eyes: [string, string],
  mouth: string,
  arms: HogArms,
): { cells: string[]; eyeCols: [number, number] } {
  const [left, right] = eyes;

  let leftSide: string[]; // glyphs before the left eye
  let rightSide: string[]; // glyphs after the right eye
  switch (arms) {
    case 'out': // ⊂|•ﻌ•|⊃
      leftSide = [ARM_L, BAR];
      rightSide = [BAR, ARM_R];
      break;
    case 'left': // ⊂|•ﻌ•⊂|
      leftSide = [ARM_L, BAR];
      rightSide = [ARM_L, BAR];
      break;
    case 'right': // |⊃•ﻌ•|⊃
      leftSide = [BAR, ARM_R];
      rightSide = [BAR, ARM_R];
      break;
    case 'none':
    default:
      leftSide = [BAR];
      rightSide = [BAR];
      break;
  }

  const cells = [...leftSide, left, mouth, right, ...rightSide];
  const leftEyeCol = leftSide.length;
  return { cells, eyeCols: [leftEyeCol, leftEyeCol + 2] };
}

/** A single row of fixed-width cells, one <Text> per glyph (forces LTR order). */
const FaceRow = ({ cells, color }: { cells: string[]; color: string }) => (
  <Box flexDirection="row">
    {cells.map((cell, i) => (
      <Text key={i} color={color}>
        {cell}
      </Text>
    ))}
  </Box>
);

interface HogFaceProps {
  expression?: HogExpression;
  /** Which eye closes when expression is 'wink'. Defaults to the right eye. */
  winkEye?: WinkEye;
  arms?: HogArms;
  color?: string;
}

export const HogFace = ({
  expression = 'neutral',
  winkEye = 'right',
  arms = 'none',
  color = Colors.accent,
}: HogFaceProps) => {
  const { eyes, mouth } = faceSpec(expression, winkEye);
  const { cells, eyeCols } = buildFace(eyes, mouth, arms);
  // Ear row: same width as the face, ears sitting directly over the eyes.
  const earCells = cells.map((_, i) => (eyeCols.includes(i) ? EAR : ' '));

  return (
    <Box flexDirection="column" alignItems="center">
      <FaceRow cells={earCells} color={color} />
      <FaceRow cells={cells} color={color} />
    </Box>
  );
};

// --- Shared timing helpers -------------------------------------------------

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// --- Idle animation (blink / wink) -----------------------------------------

/** Milliseconds per idle tick. */
const TICK_MS = 140;
/** Ticks a blink stays closed (one quick frame). */
const BLINK_FRAMES = 1;
/** Ticks a wink is held (a deliberate, slower gesture). */
const WINK_FRAMES = 4;
/** Min/max neutral hold (in ticks) between gestures. ~1.4s–4.2s. */
const MIN_NEUTRAL_TICKS = 10;
const MAX_NEUTRAL_TICKS = 30;
/** Chance a gesture is a wink rather than a blink. */
const WINK_CHANCE = 0.25;

interface AnimatedHogFaceProps {
  winkEye?: WinkEye;
  arms?: HogArms;
  color?: string;
}

/** Idle mascot: mostly neutral, occasional blink or wink. */
export const AnimatedHogFace = ({
  winkEye = 'right',
  arms = 'none',
  color = Colors.accent,
}: AnimatedHogFaceProps) => {
  const [expression, setExpression] = useState<HogExpression>('neutral');
  // Ticks remaining in the current gesture, and ticks left to wait while neutral.
  const holdRef = useRef(0);
  const waitRef = useRef(randInt(MIN_NEUTRAL_TICKS, MAX_NEUTRAL_TICKS));

  useEffect(() => {
    // Created once. The functional updater always sees the latest expression,
    // so the interval never needs to be torn down and rebuilt.
    const timer = setInterval(() => {
      setExpression((current) => {
        if (current !== 'neutral') {
          holdRef.current -= 1;
          if (holdRef.current <= 0) {
            waitRef.current = randInt(MIN_NEUTRAL_TICKS, MAX_NEUTRAL_TICKS);
            return 'neutral';
          }
          return current;
        }

        waitRef.current -= 1;
        if (waitRef.current > 0) return current;

        if (Math.random() < WINK_CHANCE) {
          holdRef.current = WINK_FRAMES;
          return 'wink';
        }
        holdRef.current = BLINK_FRAMES;
        return 'blink';
      });
    }, TICK_MS);

    return () => clearInterval(timer);
  }, []);

  return (
    <HogFace
      expression={expression}
      winkEye={winkEye}
      arms={arms}
      color={color}
    />
  );
};

// --- Snoring animation (z's rising) ----------------------------------------

/** Milliseconds per snore step (slow, drowsy). */
const SNORE_STEP_MS = 350;
/**
 * z's drifting up and to the right of the head, over a 4-step loop. Each
 * string is the width of the face (5 cells) so it centres over the head.
 *   step 0: a breath in (empty)   step 2: z risen, Z forming higher
 *   step 1: a z puffs out         step 3: z gone, Z drifting away
 */
const SNORE_Z_TOP = ['     ', '     ', '    Z', '    Z'];
const SNORE_Z_BOTTOM = ['     ', '   z ', '   z ', '     '];

/** Sleeping mascot: eyes shut, mouth open, little z's rising. */
export const SnoringHog = ({ color = Colors.accent }: { color?: string }) => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((s) => (s + 1) % SNORE_Z_TOP.length);
    }, SNORE_STEP_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column" alignItems="center">
      <Text color={color} dimColor>
        {SNORE_Z_TOP[step]}
      </Text>
      <Text color={color} dimColor>
        {SNORE_Z_BOTTOM[step]}
      </Text>
      <HogFace expression="snoring" color={color} />
    </Box>
  );
};

// --- Talking animation (mouth flap) ----------------------------------------

/** Milliseconds per talking tick. */
const TALK_TICK_MS = 150;
/** Min/max ticks the mouth holds each open/closed position. */
const TALK_MIN_HOLD = 1;
const TALK_MAX_HOLD = 2;

interface TalkingHogProps {
  arms?: HogArms;
  color?: string;
}

/**
 * Speaking mascot: the mouth opens and shuts at a slightly irregular pace to
 * mimic speech. Drive this while rendering dialogue text.
 */
export const TalkingHog = ({
  arms = 'none',
  color = Colors.accent,
}: TalkingHogProps) => {
  const [open, setOpen] = useState(false);
  const holdRef = useRef(randInt(TALK_MIN_HOLD, TALK_MAX_HOLD));

  useEffect(() => {
    const timer = setInterval(() => {
      holdRef.current -= 1;
      if (holdRef.current <= 0) {
        holdRef.current = randInt(TALK_MIN_HOLD, TALK_MAX_HOLD);
        setOpen((o) => !o);
      }
    }, TALK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // 'shocked' = open mouth (o); 'neutral' = closed snout (ﻌ).
  return (
    <HogFace
      expression={open ? 'shocked' : 'neutral'}
      arms={arms}
      color={color}
    />
  );
};
