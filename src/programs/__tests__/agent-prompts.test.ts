import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PROGRAM_REGISTRY } from '@programs/program-runner/program-registry';

const PROGRAMS = path.resolve(__dirname, '..');
// Every program that bundles prompts.
const BUNDLES = PROGRAM_REGISTRY.filter((c) => c.agentPrompts).map(
  (c) => [c.id, c] as const,
);

// The frontmatter keys the parser reads as flags, and a value as it reads one: without a comment or quotes.
const FLAG_LINE = /^\s*(seed|sink|runnerSeeded|optional):(.*)$/gm;
const flagValue = (raw: string): string =>
  raw
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '');

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

describe.each(BUNDLES)('%s agent prompts', (program, config) => {
  const own = readPrompts(path.join(PROGRAMS, program, 'agent'));

  it('imports every prompt in its agent folder', async () => {
    expect(await config.agentPrompts?.()).toEqual(own);
  });

  // The parser reads a prompt with no frontmatter as a task with no dependencies, and any flag but `true` as false.
  it('opens every prompt with frontmatter whose flags are true or false', () => {
    const problems = Object.entries(own).flatMap(([type, text]) => {
      const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1];
      if (block === undefined) return [`${type}: no frontmatter`];
      return [...block.matchAll(FLAG_LINE)]
        .filter(([, , value]) => !['true', 'false'].includes(flagValue(value)))
        .map(([line]) => `${type}: ${line.trim()}`);
    });
    expect(problems).toEqual([]);
  });
});
