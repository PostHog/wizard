import { HEADLESS_FLAG } from '@env';
import { getProgramConfig, Program, PROGRAM_REGISTRY } from '@store/programs';
import type { ProgramId } from '@store/types';
import { buildLaunch, launchWords } from '@e2e-harness/launch';
import { hasProfile } from '@e2e-harness/profiles';

const base = {
  appDir: '/tmp/app',
  socketPath: '/tmp/w/w.sock',
  projectId: '228144',
};

describe('launchWords', () => {
  it('launches every profiled program through the command its config declares', () => {
    const profiled = PROGRAM_REGISTRY.map((c) => c.id).filter((id) =>
      hasProfile(id),
    );
    expect(profiled.length).toBeGreaterThanOrEqual(9);
    for (const id of profiled) {
      const words = launchWords(id);
      if (id === Program.PostHogIntegration) expect(words).toEqual([]);
      else if (id === Program.Audit) expect(words).toEqual(['audit', 'all']);
      else expect(words, id).toEqual([getProgramConfig(id).command]);
    }
  });

  it('refuses a program with no command', () => {
    expect(() => launchWords('mcp-add' as ProgramId)).toThrow(
      /no launch command/,
    );
  });
});

describe('buildLaunch', () => {
  it('maps the run inputs to flags and keeps the key in the environment', () => {
    const { cmd, args, env } = buildLaunch(
      {
        ...base,
        programId: Program.SelfDriving,
        apiKey: 'phx_secret',
        region: 'eu',
        e2eAsk: true,
        integrate: true,
        harness: 'pi',
        sequence: 'orchestrator',
        model: 'openai/gpt-5.6-terra',
        taskStreamLog: '',
        env: {
          PATH: '/bin',
          CLAUDE_CODE: '1',
          ANTHROPIC_API_KEY: 'x',
          AI_AGENT_X: 'y',
          HOME: '/h',
        },
      },
      '/repo',
    );
    expect(cmd).toBe('/repo/node_modules/.bin/tsx');
    expect(args).toEqual([
      'bin.ts',
      'self-driving',
      '--ci',
      '--control-socket',
      '/tmp/w/w.sock',
      '--install-dir',
      '/tmp/app',
      '--project-id',
      '228144',
      '--region',
      'eu',
      '--e2e-ask',
      '--integrate',
      '--harness',
      'pi',
      '--sequence',
      'orchestrator',
      '--model',
      'openai/gpt-5.6-terra',
      '--task-stream-log',
      '',
    ]);
    expect(args.join(' ')).not.toContain('phx_secret');
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/h',
      WIZARD_ASK_AUTODRIVE: '1',
      POSTHOG_WIZARD_API_KEY: 'phx_secret',
    });
  });

  it('launches the headless surface under its flag, without the ask flag', () => {
    const { cmd, args } = buildLaunch(
      {
        ...base,
        programId: Program.PostHogIntegration,
        surface: 'headless',
        e2eAsk: true,
        bin: 'dist/bin.js',
        env: {},
      },
      '/repo',
    );
    expect(cmd).toBe('node');
    expect(args.slice(0, 4)).toEqual([
      'dist/bin.js',
      `--${HEADLESS_FLAG}`,
      '--control-socket',
      '/tmp/w/w.sock',
    ]);
    expect(args).not.toContain('--ci');
    expect(args).not.toContain('--e2e-ask');
  });

  it('drops an inherited key when the run has none', () => {
    const { env, args } = buildLaunch(
      {
        ...base,
        programId: Program.PostHogIntegration,
        env: { POSTHOG_WIZARD_API_KEY: 'stale' },
      },
      '/repo',
    );
    expect(env.POSTHOG_WIZARD_API_KEY).toBeUndefined();
    expect(args[1]).toBe('--ci');
  });
});
