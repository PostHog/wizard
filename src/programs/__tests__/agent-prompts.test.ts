import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PROGRAM_REGISTRY } from '../program-runner/program-registry';

const PROGRAMS = path.resolve(__dirname, '..');
const RECORDED = path.resolve(
  __dirname,
  '../../../fixtures/context-mill/agents',
);

// Every program that bundles prompts, with the context-mill flow they came from.
const BUNDLES = PROGRAM_REGISTRY.filter((c) => c.agentPrompts).map(
  (c) => [c.id, c.agentFlow ?? c.id, c] as const,
);

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

describe.each(BUNDLES)('%s agent prompts', (program, flow, config) => {
  const own = readPrompts(path.join(PROGRAMS, program, 'agent'));

  it('bundles its agent folder exactly (run `pnpm bundle:agent-prompts`)', async () => {
    expect(await config.agentPrompts?.()).toEqual(own);
  });

  it('matches the recorded context-mill release byte for byte', () => {
    expect(own).toEqual(readPrompts(path.join(RECORDED, flow)));
  });
});
