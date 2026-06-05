import {
  AIR_ROW,
  GROUND_ROW,
  HEDGEHOG_COL,
  JUMP_DURATION_TICKS,
  RING_VALUE,
  initialState,
  jump,
  restart,
  tick,
  type GameState,
} from '@ui/tui/screens/audit-3000/hedgehog-runner-engine';

describe('hedgehog-runner-engine', () => {
  describe('initialState', () => {
    it('starts grounded with score zero', () => {
      const s = initialState();
      expect(s.hedgehogState).toBe('grounded');
      expect(s.hedgehogRow).toBe(GROUND_ROW);
      expect(s.score).toBe(0);
      expect(s.isGameOver).toBe(false);
      expect(s.obstacles).toEqual([]);
    });

    it('accepts an initial hi-score so it survives restarts', () => {
      expect(initialState(42).hiScore).toBe(42);
    });
  });

  describe('jump', () => {
    it('lifts the hedgehog from the ground row to the air row', () => {
      const next = jump(initialState());
      expect(next.hedgehogState).toBe('jumping');
      expect(next.hedgehogRow).toBe(AIR_ROW);
      expect(next.jumpFramesRemaining).toBe(JUMP_DURATION_TICKS);
    });

    it('is a no-op while already jumping so held space keys do not stack', () => {
      const airborne = jump(initialState());
      expect(jump(airborne)).toBe(airborne);
    });

    it('is a no-op after game over', () => {
      const gameOver: GameState = { ...initialState(), isGameOver: true };
      expect(jump(gameOver)).toBe(gameOver);
    });
  });

  describe('tick', () => {
    it('increments score by one each tick while alive', () => {
      const t1 = tick(initialState());
      expect(t1.score).toBe(1);
      expect(t1.tick).toBe(1);
    });

    it('moves obstacles one column left per tick', () => {
      const seeded: GameState = {
        ...initialState(),
        obstacles: [{ kind: 'spike', x: 20, row: GROUND_ROW }],
      };
      const next = tick(seeded);
      const spike = next.obstacles.find((o) => o.kind === 'spike');
      expect(spike?.x).toBe(19);
    });

    it('drops obstacles once they leave the playfield on the left', () => {
      const seeded: GameState = {
        ...initialState(),
        obstacles: [{ kind: 'spike', x: 0, row: GROUND_ROW }],
      };
      const next = tick(seeded);
      expect(next.obstacles.find((o) => o.kind === 'spike')).toBeUndefined();
    });

    it('returns the hedgehog to the ground after the jump duration elapses', () => {
      let state = jump(initialState());
      for (let i = 0; i < JUMP_DURATION_TICKS; i++) {
        state = tick(state);
      }
      expect(state.hedgehogState).toBe('grounded');
      expect(state.hedgehogRow).toBe(GROUND_ROW);
    });

    it('ends the game and updates hi-score on spike collision', () => {
      const seeded: GameState = {
        ...initialState(7),
        obstacles: [{ kind: 'spike', x: HEDGEHOG_COL + 1, row: GROUND_ROW }],
        score: 12,
      };
      const next = tick(seeded);
      expect(next.isGameOver).toBe(true);
      expect(next.hiScore).toBe(13); // 12 + 1 survival tick
    });

    it('does not regress an existing higher hi-score on death', () => {
      const seeded: GameState = {
        ...initialState(100),
        obstacles: [{ kind: 'spike', x: HEDGEHOG_COL + 1, row: GROUND_ROW }],
        score: 5,
      };
      expect(tick(seeded).hiScore).toBe(100);
    });

    it('collects rings by adding their value and removing them', () => {
      // Hedgehog mid-jump on AIR_ROW; ring sits one column to the right.
      const seeded: GameState = {
        ...jump(initialState()),
        obstacles: [{ kind: 'ring', x: HEDGEHOG_COL + 1, row: AIR_ROW }],
      };
      const next = tick(seeded);
      expect(next.isGameOver).toBe(false);
      expect(next.score).toBe(1 + RING_VALUE);
      expect(next.obstacles.find((o) => o.kind === 'ring')).toBeUndefined();
    });

    it('ignores ticks while the game is over so the loop can idle safely', () => {
      const gameOver: GameState = { ...initialState(), isGameOver: true };
      expect(tick(gameOver)).toBe(gameOver);
    });
  });

  describe('restart', () => {
    it('resets the run but preserves the hi-score', () => {
      const ended: GameState = {
        ...initialState(),
        score: 99,
        hiScore: 250,
        isGameOver: true,
        obstacles: [{ kind: 'spike', x: 3, row: GROUND_ROW }],
      };
      const fresh = restart(ended);
      expect(fresh.score).toBe(0);
      expect(fresh.isGameOver).toBe(false);
      expect(fresh.obstacles).toEqual([]);
      expect(fresh.hiScore).toBe(250);
    });
  });
});
