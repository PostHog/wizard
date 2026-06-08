/**
 * Phase visuals — ambient ASCII visualizations of what the agent is currently
 * doing. The active phase is derived from the in-progress task labels (best-
 * effort heuristic). Each phase has its own component (under ./visualizer);
 * the orchestrator `PhaseVisual` picks which one to render.
 *
 * Width and height are passed in from the parent so visuals adapt to the
 * column they're placed in.
 */

import { Box, Text, measureElement, type DOMElement } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { useTick } from '@ui/tui/hooks/useTick';
import { AgentPhase } from '@lib/agent/agent-phase';
import { MATRIX_FADE } from './visualizer/panel';
import { MatrixRain } from './visualizer/MatrixRain';
import { LibraryShelf } from './visualizer/LibraryShelf';
import { CrateStack } from './visualizer/CrateStack';
import { DiffCascade } from './visualizer/DiffCascade';
import { Tumblers } from './visualizer/Tumblers';
import { DashboardGrid } from './visualizer/DashboardGrid';

export { AgentPhase };

// Track titles (PostHog being the "artist" — see VisualizerTab render).
const PHASE_LABELS: Record<AgentPhase, string> = {
  [AgentPhase.CodebaseScan]: 'Reading the Code',
  [AgentPhase.SkillInstall]: 'Picking the Right Skill',
  [AgentPhase.DepInstall]: 'Installing Packages',
  [AgentPhase.CodeEdits]: 'Editing Source',
  [AgentPhase.EnvSetup]: 'Wiring Up Secrets',
  [AgentPhase.Dashboards]: 'Building Dashboards',
};

/** Reads the active phase from the store. The agent loop pushes it in via
 *  `getUI().setStage(...)` whenever a new tool fires. */
export function useAgentPhase(store: WizardStore): AgentPhase {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );
  return (store.currentStage?.stage as AgentPhase) ?? AgentPhase.CodebaseScan;
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
 *
 * Sizes itself off the *measured* container rather than the raw terminal so
 * the tab bar / hints / status panel above don't get pushed off-screen on
 * short terminals. When height runs out, chrome rows drop in order:
 * transport bar first, then track title, then the NOW PLAYING header.
 */
export const VisualizerTab = ({ store }: { store: WizardStore }) => {
  const phase = useAgentPhase(store);
  const containerRef = useRef<DOMElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const tick = useTick(EQ_TICK_MS);

  useEffect(() => {
    if (!containerRef.current) return;
    const m = measureElement(containerRef.current);
    if (m.width !== size.width || m.height !== size.height) {
      setSize({ width: m.width, height: m.height });
    }
  }, [tick, size.width, size.height]);

  // Each chrome line below counts the row + its 1-row margin.
  const HEADER_ROWS = 2;
  const TITLE_ROWS = 2;
  const TRANSPORT_ROWS = 2;
  const BORDER_ROWS = 2;
  const MIN_VISUAL_H = 5;

  const availH = size.height;
  const availW = size.width;
  // Drop chrome rows greedily from the bottom up if there isn't room for the
  // minimum visual plus border.
  let chromeBudget = BORDER_ROWS + HEADER_ROWS + TITLE_ROWS + TRANSPORT_ROWS;
  let showHeader = true;
  let showTitle = true;
  let showTransport = true;
  if (availH > 0 && availH - chromeBudget < MIN_VISUAL_H) {
    showTransport = false;
    chromeBudget -= TRANSPORT_ROWS;
  }
  if (availH > 0 && availH - chromeBudget < MIN_VISUAL_H) {
    showTitle = false;
    chromeBudget -= TITLE_ROWS;
  }
  if (availH > 0 && availH - chromeBudget < MIN_VISUAL_H) {
    showHeader = false;
    chromeBudget -= HEADER_ROWS;
  }

  const visualH =
    availH > 0
      ? Math.max(MIN_VISUAL_H, Math.min(18, availH - chromeBudget))
      : MIN_VISUAL_H;
  const visualW = availW > 0 ? Math.max(20, Math.min(64, availW - 12)) : 40;

  // Anchor both the elapsed clock and the EQ beat grid to the stage's
  // startedAt — a fresh stage drops the needle on beat 1.
  const now = Date.now();
  const beatTimeMs = now - (store.currentStage?.startedAt ?? now);
  const elapsedSec = Math.max(0, Math.floor(beatTimeMs / 1000));
  const timeStr = formatElapsed(elapsedSec);
  const eqLevelsRef = useRef<number[]>(new Array(EQ_BARS).fill(0));
  const equalizer = renderMiniEqualizer(beatTimeMs, eqLevelsRef.current);

  return (
    <Box
      ref={containerRef}
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
    >
      {showHeader && (
        <Box flexDirection="row" marginBottom={1}>
          <Text color={MATRIX_FADE}>┌─</Text>
          <Text bold color="#7CFF7C">
            {' ► NOW PLAYING '}
          </Text>
          <Text color={MATRIX_FADE}>─┐</Text>
        </Box>
      )}
      {showTitle && (
        <Box marginBottom={1}>
          <Text bold color="#E6FFE6">
            {PHASE_LABELS[phase]} - PostHog
          </Text>
        </Box>
      )}
      <PhaseBody phase={phase} width={visualW} height={visualH} />
      {showTransport && (
        <Box flexDirection="row" marginTop={1} gap={2}>
          <Text color="#22D622">[{timeStr}]</Text>
          <Text color={MATRIX_FADE}>{equalizer}</Text>
          <Text color="#22D622">WizardAmp</Text>
        </Box>
      )}
    </Box>
  );
};

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 120 BPM techno in 4/4: a beat is 500 ms, a bar (measure) is 4 beats = 2 s.
const BPM = 120;
const BEAT_MS = (60 / BPM) * 1000;
const EQ_BARS = 12;
const EQ_TICK_MS = 67; // ~15 fps
// 0.08 / frame at ~15 fps ≈ 0.8 s peak-to-silence. Scale with EQ_TICK_MS if
// you change the frame rate so the decay *time* stays the same.
const EQ_FALL_PER_FRAME = 0.08;

// One "drum hit": a value that snaps to 1.0 on the beat and fades out before
// the next one. Higher `decay` = snappier (quicker fade). `phaseMs` shifts
// when the hit fires (e.g. snare lands on beat 2, not beat 1).
function pulse(
  t: number,
  periodMs: number,
  decay: number,
  phaseMs = 0,
): number {
  // `+ periodMs * 100` keeps the modulo positive when phaseMs > t (start of stage).
  const since = (t - phaseMs + periodMs * 100) % periodMs;
  return Math.exp((-decay * since) / periodMs);
}

const EQ_GLYPHS = '▁▂▃▄▅▆▇█';

function renderMiniEqualizer(beatTimeMs: number, levels: number[]): string {
  // Voices — what you'd hear in a techno track:
  //   kick   = the BOOM on every beat (the four-on-the-floor thing)
  //   bass   = a longer-ringing sub note that overlaps the kick (the rumble)
  //   clap   = the CLAP on beats 2 & 4 (the backbeat)
  //   hat8   = the TSSSS on eighth notes (twice per beat)
  //   hat16  = the faster ticka-ticka on sixteenth notes
  //   pad    = a slow background hum so the track never feels totally silent
  const kick = pulse(beatTimeMs, BEAT_MS, 4);
  const bass = pulse(beatTimeMs, BEAT_MS, 1.5);
  const clap = pulse(beatTimeMs, BEAT_MS * 2, 5, BEAT_MS);
  const hat8 = pulse(beatTimeMs, BEAT_MS / 2, 8);
  const hat16 = pulse(beatTimeMs, BEAT_MS / 4, 12);
  // Slow ~4 s wobble between 0.05 and 0.35 — ambient floor.
  const pad = 0.2 + 0.15 * Math.sin((2 * Math.PI * beatTimeMs) / 4000);

  // Each of the 12 bars is a mix of voices, going low → high like a real
  // spectrum analyzer. Low bars feel the kick + bass, mid bars feel the clap,
  // high bars feel the hats. Pad layered in everywhere so nothing dies.
  const mix = [
    bass * 0.7 + kick * 0.5 + pad,
    bass * 0.6 + kick * 0.6 + pad * 0.9,
    bass * 0.4 + kick * 0.7 + pad * 0.8,
    kick * 0.6 + clap * 0.3 + pad * 0.7,
    kick * 0.4 + clap * 0.5 + pad * 0.7,
    clap * 0.7 + hat8 * 0.3 + pad * 0.6,
    clap * 0.6 + hat8 * 0.5 + pad * 0.5,
    hat8 * 0.7 + clap * 0.3 + pad * 0.5,
    hat8 * 0.5 + hat16 * 0.4 + pad * 0.4,
    hat8 * 0.4 + hat16 * 0.5 + pad * 0.4,
    hat16 * 0.6 + hat8 * 0.3 + pad * 0.3,
    hat16 * 0.7 + pad * 0.3,
  ];

  // Winamp-style smoothing: each bar jumps up instantly to the current audio
  // level (so kicks read as snap), then drifts down by EQ_FALL_PER_FRAME each
  // frame until the next hit catches it.
  let out = '';
  for (let i = 0; i < EQ_BARS; i++) {
    const target = Math.min(1, mix[i]);
    levels[i] = Math.max(target, levels[i] - EQ_FALL_PER_FRAME);
    out += EQ_GLYPHS[Math.floor(levels[i] * (EQ_GLYPHS.length - 1))];
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
      return <DashboardGrid width={width} height={height} />;
  }
};
