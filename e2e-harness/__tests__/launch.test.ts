import { describe, expect, it } from 'vitest';
import { Program } from '@store/programs';
import type { ProgramId } from '@store/types';
import { buildLaunch, PROGRAM_COMMANDS } from '@e2e-harness/launch';
import { hasProfile } from '@e2e-harness/profiles';

const base = {
  appDir: '/tmp/app',
  socketPath: '/tmp/w/w.sock',
  projectId: '228144',
};

describe('buildLaunch', () => {
  it('launches every profiled program through its command words', () => {
    for (const id of Object.keys(PROGRAM_COMMANDS)) {
      expect(hasProfile(id), id).toBe(true);
      const { args } = buildLaunch({ ...base, programId: id }, '/repo');
      expect(args.slice(0, 1 + PROGRAM_COMMANDS[id]!.length)).toEqual([
        'bin.ts',
        ...PROGRAM_COMMANDS[id]!,
      ]);
    }
  });

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

  it('refuses a program with no launch command', () => {
    expect(() =>
      buildLaunch({ ...base, programId: 'mcp-add' as ProgramId }, '/repo'),
    ).toThrow(/no launch command/);
  });
});
