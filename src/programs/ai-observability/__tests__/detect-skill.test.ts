import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectUnambiguousAioSkill } from '../detect-skill';

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

  it('picks framework over provider (Vercel AI SDK + OpenAI)', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { ai: '^6.0.0', openai: '^4.77.0' } }),
    );
    expect(detectUnambiguousAioSkill(dir)).toBe('ai-observability-vercel-ai');
  });

  it('picks ai-observability-openai-python from pyproject.toml', () => {
    write(
      'pyproject.toml',
      '[project]\ndependencies = ["openai>=1.50.0", "fastapi>=0.115"]\n',
    );
    write('main.py', 'from openai import OpenAI\nclient = OpenAI()\n');
    expect(detectUnambiguousAioSkill(dir)).toBe(
      'ai-observability-openai-python',
    );
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

  it('returns undefined for pnpm workspaces / monorepos', () => {
    write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
    write(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^7.0.0' } }),
    );
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });

  it('returns undefined when no LLM SDK is declared (manual-capture fallback)', () => {
    write('package.json', JSON.stringify({ dependencies: { hono: '^4.0.0' } }));
    expect(detectUnambiguousAioSkill(dir)).toBeUndefined();
  });
});
