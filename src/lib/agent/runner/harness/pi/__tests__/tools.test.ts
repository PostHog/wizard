/**
 * pi wizard_ask — sensitive answers fail closed. pi has no secret-vault
 * wiring, so `sensitive: true` is rejected before the question ever reaches
 * the ask bridge (the MCP path vaults via secretRef instead).
 */
import { describe, it, expect, vi } from 'vitest';
import type { WizardAskBridge } from '@lib/wizard-ask-bridge';
import { createWizardPiTools } from '../tools';

const makeAsk = () => {
  const request = vi.fn().mockResolvedValue({ q1: 'answer' });
  const tools = createWizardPiTools({
    workingDirectory: '/tmp',
    skillsBaseUrl: 'http://localhost:0',
    askBridge: { request } as unknown as WizardAskBridge,
  });
  const wizardAsk = tools.find((t) => t.name === 'wizard_ask');
  if (!wizardAsk) throw new Error('wizard_ask not registered');
  return { wizardAsk, request };
};

const textOf = (result: unknown) =>
  (result as { content: [{ text: string }] }).content[0].text;

describe('pi wizard_ask sensitive fail-closed', () => {
  it('rejects sensitive questions before reaching the ask bridge', async () => {
    const { wizardAsk, request } = makeAsk();
    const result = await wizardAsk.execute('call-1', {
      questions: [
        {
          id: 'token',
          prompt: 'Paste your API key',
          kind: 'text',
          sensitive: true,
        },
      ],
    });
    expect(textOf(result)).toMatch(
      /question "token" sets sensitive=true, but sensitive answers are not supported/,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('a mixed batch is rejected whole — no partial ask reaches the user', async () => {
    const { wizardAsk, request } = makeAsk();
    const result = await wizardAsk.execute('call-1', {
      questions: [
        { id: 'q1', prompt: 'Which tracker?', kind: 'text' },
        {
          id: 'secret',
          prompt: 'Zendesk token',
          kind: 'text',
          sensitive: true,
        },
      ],
    });
    expect(textOf(result)).toMatch(/sensitive=true/);
    expect(request).not.toHaveBeenCalled();
  });

  it('non-sensitive questions still flow to the bridge', async () => {
    const { wizardAsk, request } = makeAsk();
    const result = await wizardAsk.execute('call-1', {
      questions: [{ id: 'q1', prompt: 'Which tracker?', kind: 'text' }],
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(textOf(result)).toContain('"q1": "answer"');
  });
});
