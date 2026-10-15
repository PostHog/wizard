import {
  createDecision,
  type DecisionQuestion,
} from '@shared/decisions-client';

describe('createDecision', () => {
  const params = { model: 'gpt-6-luna', input: 'x', questions: [] };

  it('retries a transient status once', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ answers: [], model: 'gpt-6-luna', usage: {} }),
      );
    await createDecision(params, { apiKey: 'k', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as [
      string,
      Parameters<typeof fetch>[1],
    ];
    expect(url).toBe('https://api.openai.com/v1/decisions');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer k');
  });

  it('translates to and from the gateway decision shape', async () => {
    const questions: DecisionQuestion[] = [
      { type: 'predicate', name: 'is_js', instructions: 'JS?' },
      {
        type: 'choice',
        name: 'pm',
        instructions: 'Package manager?',
        choices: [
          { value: 'pnpm', description: 'pnpm-lock.yaml' },
          { value: 'npm' },
        ],
      },
      { type: 'predicate', name: 'skipped', instructions: 'Unanswered?' },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        model: 'gpt-6-luna',
        answers: {
          is_js: { type: 'noul', noul: 0.97 },
          pm: {
            type: 'choice',
            choice: 'pnpm',
            confidence: 0.8,
            probabilities: { pnpm: 0.8, npm: 0.2 },
          },
        },
        usage: { input_tokens: 50, output_tokens: 0 },
      }),
    );
    const decision = await createDecision(
      {
        model: 'gpt-6-luna',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'a' },
              { type: 'input_text', text: 'b' },
            ],
          },
        ],
        questions,
      },
      {
        gateway: { token: 'phs_k\n', url: 'https://gateway.test/' },
        fetchImpl,
      },
    );
    const [url, init] = fetchImpl.mock.calls[0] as [
      string,
      Parameters<typeof fetch>[1],
    ];
    expect(url).toBe('https://gateway.test/v1/systemone');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer phs_k',
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'openai/gpt-6-luna',
      state: 'a\n\nb',
      questions: {
        is_js: { type: 'noul', instructions: 'JS?' },
        pm: {
          type: 'choice',
          instructions: 'Package manager?',
          criteria: { pnpm: 'pnpm-lock.yaml', npm: null },
        },
        skipped: { type: 'noul', instructions: 'Unanswered?' },
      },
    });
    expect(decision.answers).toEqual([
      { type: 'predicate', name: 'is_js', probability: 0.97 },
      {
        type: 'choice',
        name: 'pm',
        choice: 'pnpm',
        confidence: 0.8,
        probabilities: [
          { value: 'pnpm', probability: 0.8 },
          { value: 'npm', probability: 0.2 },
        ],
      },
      { type: 'refusal', name: 'skipped' },
    ]);
    expect(decision.usage.input_tokens).toBe(50);
  });

  it('does not retry a client error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(
      createDecision(params, { apiKey: 'k', fetchImpl }),
    ).rejects.toThrow(/HTTP 401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
