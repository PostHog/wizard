import { PROGRAM_REGISTRY } from '@programs';
import type { ProgramId } from '@programs/types';
import {
  getProgramContentBlocks,
  getProgramTips,
} from '@ui/tui/decks/registry';
import { getLearnDeckPrograms } from '@ui/tui/playground/demos/LearnDeckDemo';

const runDecks = [
  ['posthog-integration', 'It handles the entire PostHog setup process'],
  ['revenue-analytics-setup', 'Welcome.'],
  ['warehouse-source', 'Welcome.'],
  ['error-tracking-upload-source-maps', 'When you ship to production'],
  ['error-tracking', "I'm wiring PostHog Error Tracking"],
  ['migration', 'making a plan to migrate from Statsig'],
  ['self-driving', "It's setting up PostHog Self-driving"],
  ['agent-skill', 'Welcome.'],
  ['mcp-analytics', 'Welcome.'],
  ['replay-vision', 'Welcome.'],
  ['web-analytics-doctor', 'Welcome.'],
  ['ai-observability', 'Welcome.'],
  ['metrics', 'Welcome.'],
] as const satisfies ReadonlyArray<readonly [ProgramId, string]>;

it('keeps an outcome for every program with the standard run screen', () => {
  const actualRunPrograms = PROGRAM_REGISTRY.filter((program) =>
    program.steps.some((step) => step.screenId === 'run'),
  ).map((program) => program.id);
  expect(actualRunPrograms.sort()).toEqual(runDecks.map(([id]) => id).sort());
});

it.each(runDecks)('selects the %s learn deck', (id, expectedCopy) => {
  expect(JSON.stringify(getProgramContentBlocks(id))).toContain(expectedCopy);
});

it('selects program tips only for the two custom tips decks', () => {
  const expectedTips = new Map<ProgramId, string>([
    ['error-tracking', 'session-replay'],
    ['self-driving', 'signal-source'],
  ]);
  for (const [id] of runDecks) {
    expect(getProgramTips(id)?.[0]?.id).toBe(expectedTips.get(id));
  }
});

it('makes every standard run deck reviewable in the playground', () => {
  const ids = getLearnDeckPrograms().map((program) => program.id);
  expect([...ids].sort()).toEqual(runDecks.map(([id]) => id).sort());
  for (const id of ['mcp-analytics', 'replay-vision', 'web-analytics-doctor']) {
    expect(ids).toContain(id);
  }
  for (const id of ['mcp-add', 'slack-connect', 'audit']) {
    expect(ids).not.toContain(id);
  }
});
