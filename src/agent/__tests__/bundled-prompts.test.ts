import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  assembleSeedPrompt,
  assembleTaskPrompt,
  bundledRegistry,
  loadAgentRegistry,
  type OrchestratorPromptContext,
} from '../agent-prompt-loader';

const ROOT = path.resolve(__dirname, '../../..');
const RECORDED = path.join(ROOT, 'fixtures', 'context-mill');
const BASE_URL = 'https://context-mill.test';

// The fetch path reads the recorded release: the menu, then each prompt by its download URL's flow and id.
vi.mock('@shared/fetch-retry', () => ({
  fetchWithRetry: (url: string) => {
    const menu = JSON.parse(
      fs.readFileSync(path.join(RECORDED, 'agent-menu.json'), 'utf8'),
    ) as { agents: { id: string; flow: string; downloadUrl: string }[] };
    const file =
      url === `${BASE_URL}/agent-menu.json`
        ? path.join(RECORDED, 'agent-menu.json')
        : (() => {
            const entry = menu.agents.find((a) => a.downloadUrl === url);
            if (!entry) throw new Error(`unexpected fetch ${url}`);
            return path.join(RECORDED, 'agents', entry.flow, `${entry.id}.md`);
          })();
    const text = fs.readFileSync(file, 'utf8');
    return Promise.resolve({ text: () => Promise.resolve(text) });
  },
}));

const FLOWS: Array<[string, string]> = [
  ['error-tracking', 'error-tracking'],
  ['feature-flags', 'feature-flags'],
  ['metrics', 'metrics'],
  ['integration-v2', 'posthog-integration'],
  ['replay-vision', 'replay-vision'],
];

// Run-specific values, normalized so only the prompt text can differ.
const CONTEXT: OrchestratorPromptContext = {
  projectId: 1,
  projectApiKey: 'phc_test',
  host: {
    region: 'us',
    apiHost: 'https://us.i.posthog.com',
    appHost: 'https://us.posthog.com',
    assetHost: 'https://us-assets.i.posthog.com',
    mcpUrl: 'https://mcp.posthog.com/mcp',
  },
  examplePath: '.posthog-wizard-cache/reference/EXAMPLE.md',
  commandmentsPath: '.posthog-wizard-cache/reference/COMMANDMENTS.md',
  facts: [],
};

function programPrompts(program: string): Record<string, string> {
  const dir = path.join(ROOT, 'src', 'programs', program, 'agents');
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

describe.each(FLOWS)('bundled %s prompts', (flow, program) => {
  it('assemble byte-identically to the fetched ones', async () => {
    const fetched = await loadAgentRegistry(BASE_URL, flow);
    const bundled = bundledRegistry(programPrompts(program), flow);

    expect(bundled.types.sort()).toEqual(fetched.types.sort());
    expect(bundled.sinkTypes).toEqual(fetched.sinkTypes);
    expect(bundled.runnerSeededTypes).toEqual(fetched.runnerSeededTypes);
    expect(assembleSeedPrompt(CONTEXT, bundled.seed!.body)).toBe(
      assembleSeedPrompt(CONTEXT, fetched.seed!.body),
    );
    for (const type of fetched.types) {
      const a = bundled.get(type)!;
      const b = fetched.get(type)!;
      expect({ ...a, body: undefined }).toEqual({ ...b, body: undefined });
      expect(assembleTaskPrompt(CONTEXT, a.body, a.skills)).toBe(
        assembleTaskPrompt(CONTEXT, b.body, b.skills),
      );
    }
  });
});
