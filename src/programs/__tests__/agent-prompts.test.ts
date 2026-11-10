import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PROGRAM_REGISTRY } from '@programs/program-runner/program-registry';

const PROGRAMS = path.resolve(__dirname, '..');
const RECORDED = path.resolve(
  __dirname,
  '../../../fixtures/context-mill/agents',
);

// Every program that bundles prompts, with the context-mill flow they came from.
const BUNDLES = PROGRAM_REGISTRY.filter((c) => c.agentPrompts).map(
  (c) => [c.id, c.agentFlow ?? c.id, c] as const,
);

// Where posthog-integration's folder departs from the recorded flow: no planner, and capture waits for MCP analytics.
const PLANNER = 'integrate-posthog';
const CAPTURE_WAITS_FOR = {
  recorded: 'dependsOn: [install, init, identify]',
  bundled: 'dependsOn: [install, init, identify, mcp-analytics]',
};

function readPrompts(dir: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => [
        file.replace(/\.md$/, ''),
        fs.readFileSync(path.join(dir, file), 'utf8'),
      ]),
  );
}

it('loads the prompts of every program that has an agent folder', () => {
  const withFolder = fs
    .readdirSync(PROGRAMS)
    .filter((program) => fs.existsSync(path.join(PROGRAMS, program, 'agent')));
  expect(BUNDLES.map(([id]) => id).sort()).toEqual(withFolder.sort());
});

describe.each(BUNDLES)('%s agent prompts', (program, flow, config) => {
  const own = readPrompts(path.join(PROGRAMS, program, 'agent'));
  const recordedDir = path.join(RECORDED, flow);

  it('imports every prompt in its agent folder', async () => {
    expect(await config.agentPrompts?.()).toEqual(own);
  });

  it.skipIf(!fs.existsSync(recordedDir))(
    'matches the recorded context-mill release byte for byte',
    () => {
      const recorded = readPrompts(recordedDir);
      if (program === 'posthog-integration') {
        delete recorded[PLANNER];
        recorded.capture = recorded.capture.replace(
          CAPTURE_WAITS_FOR.recorded,
          CAPTURE_WAITS_FOR.bundled,
        );
        expect(own.capture).toContain(CAPTURE_WAITS_FOR.bundled);
      }
      expect(own).toEqual(recorded);
    },
  );
});
