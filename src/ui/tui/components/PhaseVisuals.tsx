/**
 * Phase visuals — ambient ASCII visualizations of what the agent is currently
 * doing. The active phase is derived from the in-progress task labels (best-
 * effort heuristic). Each phase has its own component; the orchestrator
 * `PhaseVisual` picks which one to render.
 *
 * Width and height are passed in from the parent so visuals adapt to the
 * column they're placed in.
 */

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
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { MatrixRain, MATRIX_FADE } from './MatrixRain';

export enum AgentPhase {
  CodebaseScan = 'codebase-scan',
  SkillInstall = 'skill-install',
  DepInstall = 'dep-install',
  CodeEdits = 'code-edits',
  EnvSetup = 'env-setup',
  Dashboards = 'dashboards',
  EventVerify = 'event-verify',
}

const PHASE_LABELS: Record<AgentPhase, string> = {
  [AgentPhase.CodebaseScan]: 'READING THE CODEBASE',
  [AgentPhase.SkillInstall]: 'PICKING THE RIGHT SKILL',
  [AgentPhase.DepInstall]: 'INSTALLING PACKAGES',
  [AgentPhase.CodeEdits]: 'EDITING SOURCE',
  [AgentPhase.EnvSetup]: 'WIRING UP SECRETS',
  [AgentPhase.Dashboards]: 'BUILDING DASHBOARDS',
  [AgentPhase.EventVerify]: 'WATCHING EVENTS ARRIVE',
};

// Order matters — first match wins. Specific patterns first, broad explorer
// catch-all last. EventVerify deliberately narrow so "find files for event
// tracking" lands on CodebaseScan, not EventVerify.
const PATTERNS: { phase: AgentPhase; re: RegExp }[] = [
  {
    phase: AgentPhase.SkillInstall,
    re: /install[_-]?skill|load.*skill|skill[_-]menu|SKILL\.md/i,
  },
  {
    phase: AgentPhase.DepInstall,
    re: /install.*(package|posthog-(js|node|python|react|svelte)|sdk|dependenc)|verify.*dependenc|pnpm install|npm install|yarn add/i,
  },
  {
    phase: AgentPhase.EnvSetup,
    re: /\benv\b|\.env|secret|api[_-]?key\b|token|set_env_values|check_env_keys|environment variable/i,
  },
  {
    phase: AgentPhase.Dashboards,
    re: /dashboard|insight\b|chart\b|onboarding insight/i,
  },
  {
    phase: AgentPhase.EventVerify,
    re: /\$pageview|\$autocapture|posthog\.capture|telemetry health|received.*event|emit.*event/i,
  },
  {
    phase: AgentPhase.CodeEdits,
    re: /\b(create|write|edit|update|add|modify|generate|instrument|provider)\b/i,
  },
  {
    phase: AgentPhase.CodebaseScan,
    re: /check|find|locate|search|read|scan|inspect|explore|analy[sz]e|grep|glob/i,
  },
];

function classifyLabel(label: string): AgentPhase | null {
  for (const { phase, re } of PATTERNS) {
    if (re.test(label)) return phase;
  }
  return null;
}

export function useAgentPhase(store: WizardStore): AgentPhase {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );
  const lastDetectedRef = useRef<AgentPhase>(AgentPhase.CodebaseScan);
  const tasks = store.tasks;
  const detected = useMemo(() => {
    for (let i = tasks.length - 1; i >= 0; i--) {
      const t = tasks[i];
      if (t.status !== 'in_progress') continue;
      const phase = classifyLabel(t.label) || classifyLabel(t.activeForm ?? '');
      if (phase) return phase;
    }
    return null;
  }, [tasks]);
  if (detected) lastDetectedRef.current = detected;
  return lastDetectedRef.current;
}

interface PhaseVisualProps {
  store: WizardStore;
  width: number;
  height: number;
}

export const PhaseVisual = ({ store, width, height }: PhaseVisualProps) => {
  const phase = useAgentPhase(store);
  return <PhaseBody phase={phase} width={width} height={height} />;
};

/**
 * VisualizerTab — Winamp-style fullscreen take on the phase visual.
 * "NOW PLAYING" header, centered visual, transport bar with elapsed time.
 */
export const VisualizerTab = ({ store }: { store: WizardStore }) => {
  const phase = useAgentPhase(store);
  const [columns, rows] = useStdoutDimensions();
  const startRef = useRef(Date.now());
  // Re-render every 180 ms so the EQ bars wobble; the elapsed clock derives
  // its seconds from Date.now() each render so it still advances 1 Hz.
  const tick = useTick(180);

  const visualW = Math.max(20, Math.min(64, columns - 12));
  const visualH = Math.max(7, Math.min(18, rows - 12));
  const elapsedSec = Math.floor((Date.now() - startRef.current) / 1000);
  const timeStr = formatElapsed(elapsedSec);
  const equalizer = renderMiniEqualizer(tick);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Box flexDirection="row" marginBottom={1}>
        <Text color={MATRIX_FADE}>┌─</Text>
        <Text bold color="#7CFF7C">
          {' ► NOW PLAYING '}
        </Text>
        <Text color={MATRIX_FADE}>─┐</Text>
      </Box>
      <Box marginBottom={1}>
        <Text bold color="#E6FFE6">
          AGENT.run :: {PHASE_LABELS[phase]}
        </Text>
      </Box>
      <PhaseBody phase={phase} width={visualW} height={visualH} />
      <Box flexDirection="row" marginTop={1} gap={2}>
        <Text color="#22D622">[{timeStr}]</Text>
        <Text color={MATRIX_FADE}>{equalizer}</Text>
        <Text color="#22D622">WIZARD-FM 88.0</Text>
      </Box>
    </Box>
  );
};

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderMiniEqualizer(t: number): string {
  // Pseudo-EQ bars driven by the elapsed-second clock — no extra interval
  // needed, just a bit of motion as the seconds tick.
  const bars = '▁▂▃▄▅▆▇█';
  let out = '';
  for (let i = 0; i < 12; i++) {
    const h = (Math.sin(i * 0.7 + t * 0.5) + Math.cos(i * 1.3 + t * 0.3)) / 2;
    const idx = Math.floor(((h + 1) / 2) * (bars.length - 1));
    out += bars[idx];
  }
  return out;
}

const PhaseBody = ({
  phase,
  width,
  height,
}: {
  phase: AgentPhase;
  width: number;
  height: number;
}) => {
  switch (phase) {
    case AgentPhase.CodebaseScan:
      return <MatrixRain width={width} height={height} />;
    case AgentPhase.SkillInstall:
      return <LibraryShelf width={width} height={height} />;
    case AgentPhase.DepInstall:
      return <CrateStack width={width} height={height} />;
    case AgentPhase.CodeEdits:
      return <DiffCascade width={width} height={height} />;
    case AgentPhase.EnvSetup:
      return <Tumblers width={width} height={height} />;
    case AgentPhase.Dashboards:
      return <TrendLine width={width} height={height} />;
    case AgentPhase.EventVerify:
      return <StreamTicker width={width} height={height} />;
  }
};

interface VisualProps {
  width: number;
  height: number;
}

// Shared shell — every visual sits inside the same rounded green frame so
// transitions between phases stay visually continuous.
const Panel = ({ children }: { children: ReactNode }) => (
  <Box flexDirection="column" borderStyle="round" borderColor={MATRIX_FADE}>
    {children}
  </Box>
);

function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

// ── 1. LibraryShelf ──────────────────────────────────────────────
//
// A row of book spines. One spine peels forward each cycle, the chosen
// title hovers next to it, then it slides home and the next one is picked.

const BOOK_LABELS = [
  'nx',
  'rt',
  'sv',
  'fl',
  'jg',
  'rb',
  'go',
  'dj',
  'fa',
  'lv',
  'ts',
  'py',
];
const BOOK_COLORS = ['#22D622', '#7CFF7C', '#5BE05B', '#A0F0A0', '#36B536'];

const LibraryShelf = ({ width, height }: VisualProps) => {
  const tick = useTick(380);
  const bookCount = Math.min(Math.floor((width - 2) / 2), BOOK_LABELS.length);
  // Cycle phases: 0 = at rest, 1 = selecting, 2 = pulled out, 3 = returning.
  const cyclePos = tick % (bookCount * 4);
  const selectedIdx = Math.floor(cyclePos / 4);
  const phase = cyclePos % 4;
  const offset = phase === 0 ? 0 : phase === 1 ? 1 : phase === 2 ? 2 : 1;
  const wobble = phase === 2 && tick % 2 === 0 ? 1 : 0;

  const shelfY = Math.floor(height / 2) - 1;
  const rows: string[][] = Array.from({ length: height }, () =>
    new Array(width).fill(' '),
  );

  for (let i = 0; i < bookCount; i++) {
    const x = 1 + i * 2;
    const isSelected = i === selectedIdx;
    const shift = isSelected ? offset : 0;
    const wob = isSelected && wobble ? -1 : 0;
    if (x + shift >= width) continue;
    rows[shelfY - 1][x + shift] = '█';
    rows[shelfY][x + shift] = BOOK_LABELS[i][0];
    rows[shelfY + 1][x + shift] = BOOK_LABELS[i][1];
    rows[shelfY + 2 + wob]?.[x + shift] !== undefined &&
      (rows[shelfY + 2 + wob][x + shift] = '█');
  }

  // Shelf board underneath
  const boardY = shelfY + 3;
  if (boardY < height) {
    for (let x = 0; x < width; x++) rows[boardY][x] = '─';
  }
  // Floating label next to the selected book
  if (phase === 2) {
    const labelStartX = 1 + selectedIdx * 2 + 4;
    const labelText = BOOK_LABELS[selectedIdx] + '-app';
    for (let c = 0; c < labelText.length && labelStartX + c < width; c++) {
      rows[shelfY][labelStartX + c] = labelText[c];
    }
    if (labelStartX - 1 < width && labelStartX - 1 >= 0) {
      rows[shelfY][labelStartX - 1] = '▶';
    }
  }

  return (
    <Panel>
      {rows.map((row, y) => (
        <Box key={y}>
          {row.map((ch, x) => {
            if (ch === ' ') return <Text key={x}> </Text>;
            if (ch === '─') {
              return (
                <Text key={x} color={MATRIX_FADE} dimColor>
                  ─
                </Text>
              );
            }
            if (ch === '▶') {
              return (
                <Text key={x} bold color={'#E6FFE6'}>
                  ▶
                </Text>
              );
            }
            const booksColor =
              BOOK_COLORS[
                (Math.floor((x - 1) / 2) + 17 * y) % BOOK_COLORS.length
              ];
            const selectedX = 1 + selectedIdx * 2 + offset;
            const isSel = x === selectedX;
            return (
              <Text key={x} bold={isSel} color={isSel ? '#E6FFE6' : booksColor}>
                {ch}
              </Text>
            );
          })}
        </Box>
      ))}
    </Panel>
  );
};

// ── 2. CrateStack ────────────────────────────────────────────────
//
// Boxes drop from the top and stack at the bottom. Each new arrival lands
// with a tiny shake.

const PACKAGE_NAMES = [
  'posthog-js',
  'posthog-node',
  'posthog-py',
  'posthog-rb',
  'posthog-go',
  'posthog-mcp',
  'react-ph',
  'next-ph',
  '@posthog/ai',
  'posthog-snippet',
];

interface CrateState {
  stack: { label: string; x: number; landedAt: number }[];
  falling: { label: string; x: number; y: number } | null;
  spawnCooldown: number;
}

const CrateStack = ({ width, height }: VisualProps) => {
  const tick = useTick(95);
  const stateRef = useRef<CrateState>({
    stack: [],
    falling: null,
    spawnCooldown: 0,
  });

  const state = stateRef.current;
  const crateW = 8;
  const crateH = 1;
  const floorY = height - 1;

  if (state.falling) {
    state.falling.y += 1;
    const collisionStackHeight =
      state.stack.filter((c) => Math.abs(c.x - state.falling!.x) < crateW - 1)
        .length * crateH;
    if (state.falling.y >= floorY - collisionStackHeight) {
      state.stack.push({
        label: state.falling.label,
        x: state.falling.x,
        landedAt: tick,
      });
      state.falling = null;
      state.spawnCooldown = 3;
    }
  } else if (state.spawnCooldown > 0) {
    state.spawnCooldown -= 1;
  } else if (state.stack.length < Math.floor(height / crateH) - 1) {
    state.falling = {
      label: PACKAGE_NAMES[Math.floor(Math.random() * PACKAGE_NAMES.length)],
      x: 2 + Math.floor(Math.random() * Math.max(1, width - crateW - 4)),
      y: -1,
    };
  } else {
    // Stack full — wipe and restart for the next cycle.
    if (tick % 20 === 0) {
      state.stack = [];
    }
  }

  const grid: string[][] = Array.from({ length: height }, () =>
    new Array(width).fill(' '),
  );
  const drawCrate = (cx: number, cy: number, label: string, shake: number) => {
    const x = cx + shake;
    if (cy < 0 || cy >= height) return;
    const labelTrimmed = label.slice(0, crateW - 2);
    const padded = `[${labelTrimmed}]`.padEnd(crateW, ' ');
    for (let i = 0; i < crateW && x + i < width; i++) {
      if (x + i >= 0) grid[cy][x + i] = padded[i];
    }
  };

  state.stack.forEach((c, idx) => {
    const cy = floorY - idx;
    const shake =
      tick - c.landedAt === 0 ? 1 : tick - c.landedAt === 1 ? -1 : 0;
    drawCrate(c.x, cy, c.label, shake);
  });
  if (state.falling) {
    drawCrate(state.falling.x, state.falling.y, state.falling.label, 0);
  }

  return (
    <Panel>
      {grid.map((row, y) => (
        <Box key={y}>
          {row.map((ch, x) => {
            if (ch === ' ') return <Text key={x}> </Text>;
            const isFalling =
              state.falling &&
              y === state.falling.y &&
              Math.abs(x - state.falling.x) < crateW;
            return (
              <Text
                key={x}
                bold={isFalling}
                color={isFalling ? '#E6FFE6' : '#22D622'}
              >
                {ch}
              </Text>
            );
          })}
        </Box>
      ))}
    </Panel>
  );
};

// ── 3. DiffCascade ───────────────────────────────────────────────
//
// + and - code lines scroll upward continuously. Occasional comment-rewrite
// gag: a "// hmm…" line appears, gets - struck out, then a + replaces it.

const CODE_SNIPPETS = [
  "import posthog from 'posthog-js'",
  'posthog.init(KEY, { host: HOST })',
  '<PostHogProvider client={posthog}>',
  '  {children}',
  '</PostHogProvider>',
  "posthog.capture('page_viewed')",
  "posthog.capture('signup_started')",
  'posthog.identify(user.id, { email })',
  "if (process.env.NODE_ENV !== 'test') posthog.init(KEY)",
  'export const posthog = new PostHog(KEY)',
  '// TODO: enable replay',
  'window.posthog = posthog',
];

const WHIMSY_COMMENTS = [
  '// hmm — that should be a hook',
  '// wait, refactor incoming',
  '// posthog says hi',
];

interface DiffLine {
  sign: '+' | '-' | ' ';
  text: string;
}

const DiffCascade = ({ width, height }: VisualProps) => {
  const tick = useTick(280);
  const linesRef = useRef<DiffLine[]>([]);

  if (linesRef.current.length === 0) {
    for (let i = 0; i < height; i++) {
      linesRef.current.push({
        sign: Math.random() < 0.75 ? '+' : '-',
        text: CODE_SNIPPETS[Math.floor(Math.random() * CODE_SNIPPETS.length)],
      });
    }
  }
  // Scroll up by one each tick, push a new line at bottom.
  linesRef.current.shift();
  const whimsy = tick % 23 === 0;
  linesRef.current.push({
    sign: whimsy ? '-' : Math.random() < 0.78 ? '+' : '-',
    text: whimsy
      ? WHIMSY_COMMENTS[Math.floor(Math.random() * WHIMSY_COMMENTS.length)]
      : CODE_SNIPPETS[Math.floor(Math.random() * CODE_SNIPPETS.length)],
  });

  const lines = linesRef.current;
  return (
    <Panel>
      {Array.from({ length: height }).map((_, y) => {
        const line = lines[y];
        const cap = width - 2;
        const text = `${line.sign} ${line.text}`.slice(0, cap);
        const color =
          line.sign === '+'
            ? '#22D622'
            : line.sign === '-'
            ? '#D63B22'
            : MATRIX_FADE;
        return (
          <Box key={y}>
            <Text color={color}>{text.padEnd(cap, ' ')}</Text>
          </Box>
        );
      })}
    </Panel>
  );
};

// ── 4. Tumblers ──────────────────────────────────────────────────
//
// Pins fall into a lock cylinder one by one; when all six align the bolt
// pulses green for a beat, then the cycle restarts.

interface TumblerState {
  heights: number[]; // settled height per pin, 0 = unset
  current: number; // index of pin currently falling
  fallY: number; // current Y of the falling pin (in rows)
  pulse: number; // pulse counter once all pins land
}

const Tumblers = ({ width, height }: VisualProps) => {
  const tick = useTick(80);
  const pinCount = Math.min(Math.floor((width - 2) / 2), 6);
  const stateRef = useRef<TumblerState>({
    heights: new Array(pinCount).fill(0),
    current: 0,
    fallY: 0,
    pulse: 0,
  });
  const state = stateRef.current;

  const cylinderTop = 1;
  const cylinderBottom = height - 2;
  const targetForPin = (i: number) =>
    cylinderBottom - 1 - (i % 3) - Math.floor(i / 2);

  if (state.pulse > 0) {
    state.pulse -= 1;
    if (state.pulse === 0) {
      state.heights = new Array(pinCount).fill(0);
      state.current = 0;
      state.fallY = 0;
    }
  } else if (state.current < pinCount) {
    state.fallY += 1;
    if (state.fallY >= targetForPin(state.current)) {
      state.heights[state.current] = targetForPin(state.current);
      state.current += 1;
      state.fallY = cylinderTop;
    }
  } else {
    state.pulse = 14;
  }

  const grid: string[][] = Array.from({ length: height }, () =>
    new Array(width).fill(' '),
  );
  // Outer cylinder walls
  for (let y = 0; y < height; y++) {
    grid[y][0] = '│';
    grid[y][width - 1] = '│';
  }
  // Top notches (where pins enter)
  for (let i = 0; i < pinCount; i++) {
    const x = 1 + i * 2 + 1;
    if (x < width) grid[0][x] = '▼';
  }
  // Floor
  for (let x = 1; x < width - 1; x++) grid[height - 1][x] = '─';
  // Settled pins
  for (let i = 0; i < pinCount; i++) {
    const pinX = 1 + i * 2 + 1;
    if (pinX >= width) continue;
    const top = state.heights[i] || cylinderTop;
    for (let y = top; y <= cylinderBottom; y++) {
      grid[y][pinX] = '█';
    }
  }
  // Falling pin
  if (state.pulse === 0 && state.current < pinCount) {
    const pinX = 1 + state.current * 2 + 1;
    if (pinX < width) grid[state.fallY][pinX] = '█';
  }

  const pulsing = state.pulse > 0;
  const pulseBright = pulsing && tick % 2 === 0;
  return (
    <Panel>
      {grid.map((row, y) => (
        <Box key={y}>
          {row.map((ch, x) => {
            if (ch === ' ') return <Text key={x}> </Text>;
            if (ch === '│' || ch === '─' || ch === '▼') {
              const c = pulsing
                ? pulseBright
                  ? '#7CFF7C'
                  : MATRIX_FADE
                : MATRIX_FADE;
              return (
                <Text key={x} color={c} dimColor={!pulsing}>
                  {ch}
                </Text>
              );
            }
            const isFalling =
              state.pulse === 0 &&
              state.current < pinCount &&
              y === state.fallY &&
              x === 1 + state.current * 2 + 1;
            const color = pulsing
              ? pulseBright
                ? '#E6FFE6'
                : '#7CFF7C'
              : isFalling
              ? '#E6FFE6'
              : '#22D622';
            return (
              <Text key={x} bold={pulsing || isFalling} color={color}>
                {ch}
              </Text>
            );
          })}
        </Box>
      ))}
    </Panel>
  );
};

// ── 5. TrendLine ─────────────────────────────────────────────────
//
// A trend curve traces left to right; the leading dot glows. Occasional
// outlier spikes give a small surprise before the line resumes.

const TrendLine = ({ width, height }: VisualProps) => {
  const tick = useTick(85);
  const totalCols = width - 2;
  const progress = tick % (totalCols + 18); // pause at end for a beat
  const drawCols = Math.min(progress, totalCols);

  // Deterministic curve so the trend feels intentional, with a 1-cell
  // spike near the middle as the whimsy.
  const seed = Math.floor(tick / (totalCols + 18));
  const spikeAt = 4 + ((seed * 7) % Math.max(1, totalCols - 6));
  const curveY = (x: number): number => {
    const norm = x / Math.max(1, totalCols);
    const base = height - 2 - norm * (height - 3);
    if (x === spikeAt) return Math.max(1, Math.round(base - 2));
    return Math.round(base + 0.5 * Math.sin(x * 0.6 + seed));
  };

  const grid: string[][] = Array.from({ length: height }, () =>
    new Array(width).fill(' '),
  );
  // Axis
  for (let x = 0; x < width; x++) grid[height - 1][x] = '─';
  grid[height - 1][0] = '│';

  for (let x = 0; x < drawCols; x++) {
    const y = curveY(x);
    if (y < 0 || y >= height - 1) continue;
    const dist = drawCols - x;
    let ch = '·';
    if (dist === 0) ch = '●';
    else if (dist < 3) ch = '∙';
    else ch = '·';
    grid[y][x + 1] = ch;
  }

  return (
    <Panel>
      {grid.map((row, y) => (
        <Box key={y}>
          {row.map((ch, x) => {
            if (ch === ' ') return <Text key={x}> </Text>;
            if (ch === '─' || ch === '│') {
              return (
                <Text key={x} color={MATRIX_FADE} dimColor>
                  {ch}
                </Text>
              );
            }
            if (ch === '●') {
              return (
                <Text key={x} bold color={'#E6FFE6'}>
                  ●
                </Text>
              );
            }
            if (ch === '∙') {
              return (
                <Text key={x} color={'#7CFF7C'}>
                  ∙
                </Text>
              );
            }
            return (
              <Text key={x} color={'#22D622'}>
                ·
              </Text>
            );
          })}
        </Box>
      ))}
    </Panel>
  );
};

// ── 6. StreamTicker ──────────────────────────────────────────────
//
// Newest event at the bottom; older events scroll up & dim. Occasional
// playful event name slips in.

const EVENT_NAMES = [
  '$pageview',
  '$autocapture',
  '$pageleave',
  '$identify',
  '$set',
  'signup_started',
  'signup_completed',
  'button_clicked',
  'form_submitted',
  'feature_used',
];
const EVENT_WHIMSY = ['$mood_check', '$bug_squashed', '$coffee_break'];
const EVENT_CONTEXTS = [
  '/',
  '/pricing',
  '/login',
  '/dashboard',
  'button.cta',
  'a.signup',
  'form.contact',
  '/changelog',
];

interface TickerLine {
  time: string;
  name: string;
  context: string;
}

const StreamTicker = ({ width, height }: VisualProps) => {
  const tick = useTick(550);
  const linesRef = useRef<TickerLine[]>([]);
  const nowRef = useRef(Date.now() - height * 3000);

  if (linesRef.current.length < height) {
    while (linesRef.current.length < height) {
      nowRef.current += 1000 + Math.floor(Math.random() * 2500);
      linesRef.current.push(makeTickerLine(nowRef.current, tick));
    }
  } else {
    linesRef.current.shift();
    nowRef.current += 1000 + Math.floor(Math.random() * 2500);
    linesRef.current.push(makeTickerLine(nowRef.current, tick));
  }

  const lines = linesRef.current;
  return (
    <Panel>
      {Array.from({ length: height }).map((_, y) => {
        const line = lines[y];
        const dist = height - 1 - y;
        const color =
          dist === 0
            ? '#E6FFE6'
            : dist < 2
            ? '#7CFF7C'
            : dist < 4
            ? '#22D622'
            : MATRIX_FADE;
        const bold = dist === 0;
        const text = `> ${line.time} ${line.name.padEnd(16, ' ')} ${
          line.context
        }`.slice(0, width - 2);
        return (
          <Box key={y}>
            <Text bold={bold} color={color} dimColor={dist >= 4}>
              {text.padEnd(width - 2, ' ')}
            </Text>
          </Box>
        );
      })}
    </Panel>
  );
};

function makeTickerLine(now: number, tick: number): TickerLine {
  const d = new Date(now);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  const whimsy = tick % 17 === 0;
  const pool = whimsy ? EVENT_WHIMSY : EVENT_NAMES;
  return {
    time,
    name: pool[Math.floor(Math.random() * pool.length)],
    context: EVENT_CONTEXTS[Math.floor(Math.random() * EVENT_CONTEXTS.length)],
  };
}
