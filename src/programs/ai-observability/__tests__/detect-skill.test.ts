import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PromptContext } from '@agent/types';
import { detectUnambiguousAioSkill } from '../detect-skill';
import { config as aioProgramConfig } from '../index';

describe('detectUnambiguousAioSkill', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aio-detect-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (rel: string, content: string) => {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };

  it('picks ai-observability-openai-node for a plain OpenAI Node app', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^4.77.0' } }),
    );
    write('src/index.ts', "import OpenAI from 'openai'; new OpenAI();");
    expect(detectUnambiguousAioSkill(dir)).toBe('ai-observability-openai-node');
  });

  it('picks framework over single underlying provider (Vercel AI SDK + OpenAI)', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { ai: '^6.0.0', openai: '^4.77.0' } }),
    );
    write('src/index.ts', "import { generateText } from 'ai';");
    expect(detectUnambiguousAioSkill(dir)).toBe('ai-observability-vercel-ai');
  });

  it('returns undefined when a single framework coexists with multiple providers', () => {
    write(
      'package.json',
      JSON.stringify({
        dependencies: {
          ai: '^6.0.0',
          openai: '^4.77.0',
          '@anthropic-ai/sdk': '^0.30.0',
        },
      }),
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('returns undefined when a single framework has a gateway baseURL override', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { ai: '^6.0.0', openai: '^4.77.0' } }),
    );
    write(
      'src/client.ts',
      "const client = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1' });",
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('picks ai-observability-openai-python from PEP 621 pyproject.toml', () => {
    write(
      'pyproject.toml',
      '[project]\ndependencies = ["openai>=1.50.0", "fastapi>=0.115"]\n',
    );
    write('main.py', 'from openai import OpenAI\nclient = OpenAI()\n');
    expect(detectUnambiguousAioSkill(dir)).toBe(
      'ai-observability-openai-python',
    );
  });

  it('picks ai-observability-openai-python from [tool.poetry.dependencies]', () => {
    write(
      'pyproject.toml',
      '[tool.poetry.dependencies]\npython = "^3.11"\nopenai = "^1.50.0"\n',
    );
    write('app.py', 'from openai import OpenAI\n');
    expect(detectUnambiguousAioSkill(dir)).toBe(
      'ai-observability-openai-python',
    );
  });

  it('ignores quoted package names outside dependency sections in pyproject.toml', () => {
    write(
      'pyproject.toml',
      '[project]\nname = "openai"\ndescription = "Integrates with openai and anthropic"\nkeywords = ["openai"]\ndependencies = ["fastapi>=0.115"]\n',
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('returns undefined when OpenAI uses a gateway baseURL override', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^4.77.0' } }),
    );
    write(
      'src/index.ts',
      "new OpenAI({ baseURL: 'https://api.groq.com/openai/v1' });",
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('returns undefined for pre-1.0 openai pins', () => {
    write('requirements.txt', 'openai==0.28.1\n');
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('returns undefined when multiple plain providers exist', () => {
    write(
      'package.json',
      JSON.stringify({
        dependencies: { openai: '^7.0.0', '@anthropic-ai/sdk': '^1.0.0' },
      }),
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('returns undefined for pnpm workspaces, package.json workspaces, and go.mod', () => {
    write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^7.0.0' } }),
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();

    rmSync(join(dir, 'pnpm-workspace.yaml'));
    write(
      'package.json',
      JSON.stringify({
        workspaces: ['apps/*'],
        dependencies: { openai: '^7.0.0' },
      }),
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();

    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^7.0.0' } }),
    );
    write('go.mod', 'module example.com/app\ngo 1.25\n');
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('returns undefined for mixed Node and Python LLM dependencies', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^4.77.0' } }),
    );
    write('requirements.txt', 'anthropic>=0.40.0\n');
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('falls back to undefined when source file count exceeds maxScanFiles', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^4.77.0' } }),
    );
    write('src/a.ts', 'export const a = 1;');
    write('src/b.ts', 'export const b = 2;');
    write('src/c.ts', 'export const c = 3;');

    expect(detectUnambiguousAioSkill(dir, { maxScanFiles: 3 })).toBe(
      'ai-observability-openai-node',
    );
    expect(detectUnambiguousAioSkill(dir, { maxScanFiles: 2 })).toBeUndefined();
  });

  it('does not loop on symlinked directories when scanning for gateway overrides', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^4.77.0' } }),
    );
    write('src/index.ts', "import OpenAI from 'openai'; new OpenAI();");
    symlinkSync(dir, join(dir, 'src/loop'));

    expect(detectUnambiguousAioSkill(dir)).toBe('ai-observability-openai-node');
  });

  it('returns undefined when no LLM SDK is declared (manual-capture fallback)', () => {
    write('package.json', JSON.stringify({ dependencies: { hono: '^4.0.0' } }));
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('maps unscoped mastra package to ai-observability-mastra', () => {
    write(
      'package.json',
      JSON.stringify({
        dependencies: { mastra: '^0.10.0', openai: '^4.77.0' },
      }),
    );
    write('src/index.ts', "import { Mastra } from 'mastra';");
    expect(detectUnambiguousAioSkill(dir)).toBe('ai-observability-mastra');
  });

  it('returns undefined for Azure OpenAI using the openai SDK', () => {
    write('requirements.txt', 'openai>=1.50.0\n');
    write(
      'app.py',
      'from openai import AzureOpenAI\nclient = AzureOpenAI(azure_endpoint="https://my.openai.azure.com")\n',
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('detects split LangChain and LlamaIndex integration packages as frameworks', () => {
    write('requirements.txt', 'langchain-openai>=0.2.0\nopenai>=1.50.0\n');
    expect(detectUnambiguousAioSkill(dir)).toBe(
      'ai-observability-langchain-python',
    );

    write(
      'requirements.txt',
      'llama-index-core>=0.11.0\nllama-index-llms-openai>=0.2.0\nopenai>=1.50.0\n',
    );
    expect(detectUnambiguousAioSkill(dir)).toBe('ai-observability-llamaindex');

    rmSync(join(dir, 'requirements.txt'));
    write(
      'package.json',
      JSON.stringify({
        dependencies: { '@langchain/openai': '^0.3.0', openai: '^4.77.0' },
      }),
    );
    expect(detectUnambiguousAioSkill(dir)).toBe(
      'ai-observability-langchain-node',
    );

    // Exact match @langchain/langgraph is not double-counted by the @langchain/ prefix.
    write(
      'package.json',
      JSON.stringify({
        dependencies: { '@langchain/langgraph': '^0.2.0' },
      }),
    );
    expect(detectUnambiguousAioSkill(dir)).toBe(
      'ai-observability-langgraph-node',
    );
  });

  it('detects gateway overrides in .env files and .jsx/.mts/.cts sources', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^4.77.0' } }),
    );
    write('.env.local', 'OPENAI_BASE_URL=https://openrouter.ai/api/v1\n');
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();

    rmSync(join(dir, '.env.local'));
    write(
      'src/client.mts',
      "new OpenAI({ baseURL: 'https://openrouter.ai/api/v1' });",
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();

    rmSync(join(dir, 'src/client.mts'));
    write(
      'src/App.jsx',
      "new OpenAI({ baseURL: 'https://api.groq.com/openai/v1' });",
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('falls back to undefined when source tree exceeds gateway scan depth', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^4.77.0' } }),
    );
    write(
      'a/b/c/d/e/f/client.ts',
      "new OpenAI({ baseURL: 'https://openrouter.ai/api/v1' });",
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('skips symlinked manifests pointing to a FIFO without blocking', () => {
    if (process.platform === 'win32') return;
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^4.77.0' } }),
    );
    const fifoPath = join(dir, 'pipe.fifo');
    execFileSync('mkfifo', [fifoPath]);
    symlinkSync(fifoPath, join(dir, 'requirements.txt'));

    expect(detectUnambiguousAioSkill(dir)).toBe('ai-observability-openai-node');
  });

  it('exposes static docsUrl on ai-observability ProgramConfig', () => {
    expect(aioProgramConfig.docsUrl).toBe(
      'https://posthog.com/docs/ai-observability',
    );
  });

  it('wires optional pre-install and prompt fallback through ai-observability config.run()', async () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^4.77.0' } }),
    );
    write('src/index.ts', "import OpenAI from 'openai'; new OpenAI();");

    if (typeof aioProgramConfig.run !== 'function') {
      throw new Error('expected ai-observability config.run to be a function');
    }
    const runDef = await aioProgramConfig.run(
      { installDir: dir } as never,
      {} as never,
    );
    expect(runDef.skillId).toBe('ai-observability-openai-node');
    expect(runDef.optionalSkill).toBe(true);

    const baseCtx = {} as PromptContext;
    const preinstalledPrompt = runDef.customPrompt?.({
      ...baseCtx,
      skillPath: '.posthog-wizard-cache/skills/ai-observability-openai-node',
    });
    expect(preinstalledPrompt).toContain('at the skill path below');
    expect(preinstalledPrompt).toContain('skip `load_skill_menu`');

    // If optional skill installation fails at preflight, ctx.skillPath is absent
    // and the prompt falls back to runtime load_skill_menu discovery.
    const fallbackPrompt = runDef.customPrompt?.(baseCtx);
    expect(fallbackPrompt).toContain('Call `load_skill_menu`');
    expect(fallbackPrompt).not.toContain('was pre-installed for you');
  });
});
