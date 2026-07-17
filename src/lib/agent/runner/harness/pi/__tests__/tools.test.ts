/**
 * pi wizard_ask + set_env_values secret-vault contract (mirrors the MCP
 * server): sensitive text answers come back as `{secretRef}` — never the raw
 * value — and set_env_values resolves refs host-side into the .env file.
 */
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  CANCELLED_SENTINEL,
  type WizardAskBridge,
} from '@lib/wizard-ask-bridge';
import { createWizardPiTools } from '../tools';

const SECRET = 'phx_live_zendesk_token_123';

const makeTools = (answers: Record<string, string | string[]>) => {
  const request = vi.fn().mockResolvedValue(answers);
  const workingDirectory = mkdtempSync(join(tmpdir(), 'pi-tools-vault-'));
  const tools = createWizardPiTools({
    workingDirectory,
    skillsBaseUrl: 'http://localhost:0',
    askBridge: { request } as unknown as WizardAskBridge,
  });
  const byName = (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`${name} not registered`);
    return tool;
  };
  return {
    request,
    workingDirectory,
    wizardAsk: byName('wizard_ask'),
    setEnvValues: byName('set_env_values'),
  };
};

const textOf = (result: unknown) =>
  (result as { content: [{ text: string }] }).content[0].text;

/** The ToolDefinition type wants the full runtime arity; the wizard tools only read (id, args). */
const call = (tool: { execute: unknown }, args: unknown): Promise<unknown> =>
  (tool.execute as (id: string, args: unknown) => Promise<unknown>)(
    'call-1',
    args,
  );

describe('pi wizard_ask — sensitive answers are vaulted', () => {
  it('returns {secretRef}, never the raw value', async () => {
    const { wizardAsk } = makeTools({ token: SECRET, tracker: 'linear' });
    const result = await call(wizardAsk, {
      questions: [
        { id: 'token', prompt: 'Zendesk token', kind: 'text', sensitive: true },
        { id: 'tracker', prompt: 'Which tracker?', kind: 'text' },
      ],
    });
    const body = textOf(result);
    expect(body).not.toContain(SECRET);
    const { answers } = JSON.parse(body) as {
      answers: { token: { secretRef: string }; tracker: string };
    };
    expect(answers.token.secretRef).toMatch(/^secret:/);
    expect(answers.tracker).toBe('linear'); // non-sensitive stays literal
  });

  it('a cancelled sensitive answer is returned as the sentinel, not vaulted', async () => {
    const { wizardAsk } = makeTools({ token: CANCELLED_SENTINEL });
    const result = await call(wizardAsk, {
      questions: [
        { id: 'token', prompt: 'Zendesk token', kind: 'text', sensitive: true },
      ],
    });
    const { answers } = JSON.parse(textOf(result)) as {
      answers: { token: string };
    };
    expect(answers.token).toBe(CANCELLED_SENTINEL);
  });

  it('still rejects sensitive=true on non-text kinds', async () => {
    const { wizardAsk, request } = makeTools({});
    const result = await call(wizardAsk, {
      questions: [
        {
          id: 'pick',
          prompt: 'Pick one',
          kind: 'single',
          sensitive: true,
          options: [{ label: 'a', value: 'a' }],
        },
      ],
    });
    expect(textOf(result)).toMatch(/Only kind="text" answers can be sensitive/);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('pi set_env_values — resolves vault refs host-side', () => {
  it('roundtrip: minted ref → real value lands in .env, never in tool output', async () => {
    const { wizardAsk, setEnvValues, workingDirectory } = makeTools({
      token: SECRET,
    });
    const asked = await call(wizardAsk, {
      questions: [
        { id: 'token', prompt: 'Zendesk token', kind: 'text', sensitive: true },
      ],
    });
    const { answers } = JSON.parse(textOf(asked)) as {
      answers: { token: { secretRef: string } };
    };

    const written = await call(setEnvValues, {
      filePath: '.env',
      values: { ZENDESK_TOKEN: answers.token },
    });
    expect(textOf(written)).not.toContain(SECRET);
    const env = await readFile(join(workingDirectory, '.env'), 'utf8');
    expect(env).toContain(`ZENDESK_TOKEN=${SECRET}`);
  });

  it('an unknown ref fails with a clear error and writes nothing', async () => {
    const { setEnvValues, workingDirectory } = makeTools({});
    const result = await call(setEnvValues, {
      filePath: '.env',
      values: { ZENDESK_TOKEN: { secretRef: 'secret:not-a-real-ref' } },
    });
    expect(textOf(result)).toMatch(/not known to the vault/);
    await expect(
      readFile(join(workingDirectory, '.env'), 'utf8'),
    ).rejects.toThrow();
  });

  it('refs do not cross runs — a ref minted by one tool set is unknown to another', async () => {
    const runA = makeTools({ token: SECRET });
    const asked = await call(runA.wizardAsk, {
      questions: [
        { id: 'token', prompt: 'Zendesk token', kind: 'text', sensitive: true },
      ],
    });
    const { answers } = JSON.parse(textOf(asked)) as {
      answers: { token: { secretRef: string } };
    };

    const runB = makeTools({});
    const result = await call(runB.setEnvValues, {
      filePath: '.env',
      values: { ZENDESK_TOKEN: answers.token },
    });
    expect(textOf(result)).toMatch(/not known to the vault/);
  });
});
