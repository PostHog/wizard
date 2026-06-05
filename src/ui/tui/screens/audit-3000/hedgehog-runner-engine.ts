/**
 * Hedgehog Runner — pure game engine.
 *
 * No Ink, React, or stdout imports. All state transitions are pure functions
 * so the game is deterministic given an RNG seed and unit-testable in
 * isolation from the TUI.
 *
 * The playfield is a fixed grid:
 *   row 0: sky        (rings can spawn here when hedgehog is mid-jump)
 *   row 1: air        (hedgehog occupies this row mid-jump; rings spawn here)
 *   row 2: ground     (hedgehog default position; spikes spawn here)
 *
 * Obstacles enter at the right edge (PLAYFIELD_WIDTH - 1) and move left one
 * column per tick. The hedgehog sits at HEDGEHOG_COL. Collision triggers when
 * an obstacle reaches HEDGEHOG_COL while occupying the same row as the
 * hedgehog.
 */

export const PLAYFIELD_WIDTH = 40;
export const HEDGEHOG_COL = 4;
export const GROUND_ROW = 2;
export const AIR_ROW = 1;
export const JUMP_DURATION_TICKS = 8;
export const SPAWN_COOLDOWN_MIN = 6;
export const SPAWN_COOLDOWN_MAX = 14;
export const RING_VALUE = 5;

export type HedgehogState = 'grounded' | 'jumping';

export interface Obstacle {
  kind: 'spike' | 'ring';
  x: number;
  row: number;
}

export interface GameState {
  hedgehogState: HedgehogState;
  hedgehogRow: number;
  jumpFramesRemaining: number;
  obstacles: Obstacle[];
  score: number;
  hiScore: number;
  isGameOver: boolean;
  tick: number;
  ticksUntilNextSpawn: number;
  rngSeed: number;
}

// Mulberry32 — deterministic PRNG, used so tests can assert exact sequences.
function nextRandom(seed: number): { value: number; nextSeed: number } {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextSeed: t >>> 0 };
}

function randomInt(seed: number, min: number, max: number) {
  const { value, nextSeed } = nextRandom(seed);
  return {
    value: min + Math.floor(value * (max - min + 1)),
    nextSeed,
  };
}

export function initialState(hiScore = 0, rngSeed = 1): GameState {
  return {
    hedgehogState: 'grounded',
    hedgehogRow: GROUND_ROW,
    jumpFramesRemaining: 0,
    obstacles: [],
    score: 0,
    hiScore,
    isGameOver: false,
    tick: 0,
    ticksUntilNextSpawn: SPAWN_COOLDOWN_MIN,
    rngSeed,
  };
}

export function jump(state: GameState): GameState {
  if (state.isGameOver) return state;
  if (state.hedgehogState !== 'grounded') return state;
  return {
    ...state,
    hedgehogState: 'jumping',
    hedgehogRow: AIR_ROW,
    jumpFramesRemaining: JUMP_DURATION_TICKS,
  };
}

export function restart(state: GameState): GameState {
  return initialState(state.hiScore, state.rngSeed);
}

export function tick(state: GameState): GameState {
  if (state.isGameOver) return state;

  let { hedgehogState, hedgehogRow, jumpFramesRemaining } = state;
  if (hedgehogState === 'jumping') {
    jumpFramesRemaining -= 1;
    if (jumpFramesRemaining <= 0) {
      hedgehogState = 'grounded';
      hedgehogRow = GROUND_ROW;
      jumpFramesRemaining = 0;
    }
  }

  const movedObstacles: Obstacle[] = [];
  let scoreDelta = 1;
  let hit = false;
  for (const obs of state.obstacles) {
    const next = { ...obs, x: obs.x - 1 };
    if (next.x < 0) continue;
    if (next.x === HEDGEHOG_COL && next.row === hedgehogRow) {
      if (next.kind === 'spike') {
        hit = true;
        movedObstacles.push(next);
        continue;
      }
      // Ring collected — score it and drop from the field.
      scoreDelta += RING_VALUE;
      continue;
    }
    movedObstacles.push(next);
  }

  let rngSeed = state.rngSeed;
  let ticksUntilNextSpawn = state.ticksUntilNextSpawn - 1;
  if (ticksUntilNextSpawn <= 0) {
    const kindRoll = nextRandom(rngSeed);
    rngSeed = kindRoll.nextSeed;
    const kind: Obstacle['kind'] = kindRoll.value < 0.65 ? 'spike' : 'ring';
    const row = kind === 'spike' ? GROUND_ROW : AIR_ROW;
    movedObstacles.push({ kind, x: PLAYFIELD_WIDTH - 1, row });

    const cooldown = randomInt(rngSeed, SPAWN_COOLDOWN_MIN, SPAWN_COOLDOWN_MAX);
    rngSeed = cooldown.nextSeed;
    ticksUntilNextSpawn = cooldown.value;
  }

  const score = state.score + scoreDelta;
  const isGameOver = hit;
  const hiScore = isGameOver ? Math.max(state.hiScore, score) : state.hiScore;

  return {
    hedgehogState,
    hedgehogRow,
    jumpFramesRemaining,
    obstacles: movedObstacles,
    score,
    hiScore,
    isGameOver,
    tick: state.tick + 1,
    ticksUntilNextSpawn,
    rngSeed,
  };
}
