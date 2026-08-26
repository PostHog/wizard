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
import { evaluateToolCall } from '../security';
import { allowedPiCodingTools, allowedOrchestratorTools } from '../task';
import {
  ASK_BATCH_THRESHOLD,
  WIZARD_ASK_SENSITIVE_DESCRIPTION,
  WIZARD_ASK_SUBJECT_DESCRIPTION,
  WIZARD_ASK_TOOL_DESCRIPTION,
} from '@lib/wizard-tools/tools';

const SECRET = 'phx_live_zendesk_token_123';

const makeTools = (
  answers: Record<string, string | string[]>,
  maxQuestions?: number,
) => {
  const request = vi.fn().mockResolvedValue(answers);
  const workingDirectory = mkdtempSync(join(tmpdir(), 'pi-tools-vault-'));
  const tools = createWizardPiTools({
    workingDirectory,
    skillsBaseUrl: 'http://localhost:0',
    askBridge: { request } as unknown as WizardAskBridge,
    triageProvider: undefined,
    maxQuestions,
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

  it('carries the shared secretRef guidance (parity with the MCP server)', () => {
    // The pi harness runs the orchestrator's warehouse credential task, so its
    // `sensitive` guidance must warn — like the MCP server's — that a vaulted
    // { secretRef } is rejected by the PostHog data-warehouse tools. Without it
    // the agent vaults a credential it must hand to source creation, the create
    // tool rejects the ref, and the task dead-ends into the browser fallback.
    const { wizardAsk } = makeTools({});
    const desc = (
      wizardAsk as unknown as {
        parameters: {
          properties: {
            questions: {
              items: {
                properties: { sensitive: { description?: string } };
              };
            };
          };
        };
      }
    ).parameters.properties.questions.items.properties.sensitive.description;
    expect(desc).toBe(WIZARD_ASK_SENSITIVE_DESCRIPTION);
    expect(desc).toMatch(/data-warehouse tools/);
    expect(desc).toMatch(/reject it/);
  });
});

describe('pi wizard_ask — the batching guard counts per subject', () => {
  /** One credential-style question, so each call is a realistic source ask. */
  const ask = (wizardAsk: { execute: unknown }, subject?: string) =>
    call(wizardAsk, {
      questions: [{ id: 'host', prompt: 'Database host?', kind: 'text' }],
      ...(subject === undefined ? {} : { subject }),
    });

  it('lets a five-source run ask once per source, all reaching the user', async () => {
    // The failure this fixes: with a run-wide count the third source tripped
    // the nudge, and agents read the nudge as a stop and fell back to links.
    const { wizardAsk, request } = makeTools({ host: 'db.example.com' });
    for (const kind of [
      'Postgres',
      'Stripe',
      'MySQL',
      'Hubspot',
      'Snowflake',
    ]) {
      const result = await ask(wizardAsk, kind);
      expect(textOf(result)).not.toMatch(/not sent/);
    }
    expect(request).toHaveBeenCalledTimes(5);
  });

  it('nudges the fourth rapid call about one source and does not send it', async () => {
    const { wizardAsk, request } = makeTools({ host: 'db.example.com' });
    for (let i = 0; i < ASK_BATCH_THRESHOLD; i++) {
      await ask(wizardAsk, 'Postgres');
    }
    const nudged = await ask(wizardAsk, 'Postgres');
    expect(textOf(nudged)).toMatch(/Not an error/);
    expect(request).toHaveBeenCalledTimes(ASK_BATCH_THRESHOLD);

    // The nudge fires once; the retry goes straight through.
    const retried = await ask(wizardAsk, 'Postgres');
    expect(textOf(retried)).not.toMatch(/Not an error/);
    expect(request).toHaveBeenCalledTimes(ASK_BATCH_THRESHOLD + 1);
  });

  it('keeps the run-wide guard for an agent that declares no subject', async () => {
    const { wizardAsk, request } = makeTools({ host: 'db.example.com' });
    for (let i = 0; i < ASK_BATCH_THRESHOLD; i++) {
      await ask(wizardAsk);
    }
    expect(textOf(await ask(wizardAsk))).toMatch(/Not an error/);
    expect(request).toHaveBeenCalledTimes(ASK_BATCH_THRESHOLD);
  });

  it('still stops at the per-run cap however many subjects were used', async () => {
    const { wizardAsk, request } = makeTools({ host: 'db.example.com' }, 3);
    for (const kind of ['Postgres', 'Stripe', 'MySQL']) {
      await ask(wizardAsk, kind);
    }
    const capped = await ask(wizardAsk, 'Snowflake');
    expect(textOf(capped)).toMatch(/cap reached/i);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not charge a cancelled ask against the per-run cap', async () => {
    // The skill promises a declined ask is free. With maxQuestions=1, a run of
    // cancellations must never exhaust the budget.
    const { wizardAsk, request } = makeTools({ host: CANCELLED_SENTINEL }, 1);
    for (let i = 0; i < 5; i++) {
      const result = await ask(wizardAsk, `Source${i}`);
      expect(textOf(result)).not.toMatch(/cap reached/i);
    }
    expect(request).toHaveBeenCalledTimes(5);
  });

  it('does not charge a bridge failure against the per-run cap', async () => {
    const { wizardAsk, request } = makeTools({}, 1);
    (
      request as unknown as { mockRejectedValue: (e: Error) => void }
    ).mockRejectedValue(new Error('overlay closed'));
    for (let i = 0; i < 3; i++) {
      expect(textOf(await ask(wizardAsk, `Source${i}`))).toMatch(
        /wizard_ask failed/,
      );
    }
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('exposes subject on the schema with the shared guidance', () => {
    const { wizardAsk } = makeTools({});
    const params = (
      wizardAsk as unknown as {
        parameters: { properties: { subject?: { description?: string } } };
      }
    ).parameters.properties;
    expect(params.subject?.description).toBe(WIZARD_ASK_SUBJECT_DESCRIPTION);
  });

  it('shares one tool description with the MCP server', () => {
    const { wizardAsk } = makeTools({});
    expect((wizardAsk as unknown as { description: string }).description).toBe(
      WIZARD_ASK_TOOL_DESCRIPTION,
    );
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

  it('mixed values map: literal + secretRef written together, secret still never in output', async () => {
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
      values: {
        POSTHOG_HOST: 'https://us.posthog.com',
        ZENDESK_TOKEN: answers.token,
      },
    });
    expect(textOf(written)).not.toContain(SECRET);
    const env = await readFile(join(workingDirectory, '.env'), 'utf8');
    expect(env).toContain('POSTHOG_HOST=https://us.posthog.com');
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

describe('pi task wiring — wizard_ask pauses Write/Edit', () => {
  it('blocks write/edit while an ask is in flight, then reallows once answered', async () => {
    // Mirrors runPiTask: one askState shared between the ask tool
    // (onAskPendingChange) and the security fence (getWizardAskPending). The
    // regression this pins is the task path forgetting to connect them, which
    // let a task mutate files while its credential prompt sat open.
    const askState = { pending: false };
    let release!: (answers: Record<string, string>) => void;
    const request = vi.fn(
      () =>
        new Promise<Record<string, string>>((resolve) => {
          release = resolve;
        }),
    );
    const [wizardAsk] = createWizardPiTools({
      workingDirectory: mkdtempSync(join(tmpdir(), 'pi-ask-pause-')),
      skillsBaseUrl: 'http://localhost:0',
      askBridge: { request } as unknown as WizardAskBridge,
      triageProvider: undefined,
      onAskPendingChange: (pending) => {
        askState.pending = pending;
      },
    }).filter((t) => t.name === 'wizard_ask');

    const gate = { getWizardAskPending: () => askState.pending };
    const write = { path: 'src/app.ts', content: 'x' };
    const edit = { path: 'src/app.ts', edits: [] };

    // Before asking, writes flow.
    expect((await evaluateToolCall('write', write, gate)).block).toBe(false);

    // Open the overlay but do not answer — the credential prompt is on screen.
    const inFlight = call(wizardAsk, {
      questions: [
        { id: 'pw', prompt: 'DB password', kind: 'text', sensitive: true },
      ],
    });
    await Promise.resolve();
    expect(askState.pending).toBe(true);
    expect((await evaluateToolCall('write', write, gate)).block).toBe(true);
    expect((await evaluateToolCall('edit', edit, gate)).block).toBe(true);

    // Answer — the overlay closes and writes flow again.
    release({ pw: CANCELLED_SENTINEL });
    await inFlight;
    expect(askState.pending).toBe(false);
    expect((await evaluateToolCall('write', write, gate)).block).toBe(false);
  });
});

describe('pi task tool grant — the names the inventory shows', () => {
  it('maps wizard vocab to the pi tools the agent actually calls', () => {
    // The bug this pins: the inventory used to show "Glob"/"Read"; the pi agent
    // calls `find`/`ls`/`read`. The grant is the pi names, so the inventory is too.
    expect([...allowedPiCodingTools(['Glob', 'Read'])].sort()).toEqual([
      'find',
      'ls',
      'read',
    ]);
    expect([...allowedPiCodingTools(['Bash'])]).toEqual(['bash']);
  });

  it('grants every queue tool a task does not disallow', () => {
    expect([...allowedOrchestratorTools(['enqueue_task'])].sort()).toEqual([
      'complete_task',
      'read_handoffs',
    ]);
  });
});
