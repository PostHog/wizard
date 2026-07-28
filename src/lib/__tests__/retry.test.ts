import { retryWithBackoff } from '@lib/retry';

describe('retryWithBackoff', () => {
  const noSleep = () => Promise.resolve();

  it('returns the first success without sleeping', async () => {
    let calls = 0;

    const result = await retryWithBackoff(
      () => {
        calls += 1;
        return Promise.resolve('ok');
      },
      {
        sleepImpl: () => {
          throw new Error('should not sleep');
        },
      },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('doubles the backoff between attempts', async () => {
    const sleeps: number[] = [];
    let calls = 0;

    const result = await retryWithBackoff(
      () => {
        calls += 1;
        if (calls < 3) return Promise.reject(new Error('flaky'));
        return Promise.resolve('ok');
      },
      {
        sleepImpl: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
        backoffMs: 500,
      },
    );

    expect(result).toBe('ok');
    expect(sleeps).toEqual([500, 1000]);
  });

  it('rethrows the last error once attempts are exhausted', async () => {
    let calls = 0;

    await expect(
      retryWithBackoff(
        () => {
          calls += 1;
          return Promise.reject(new Error(`failure ${calls}`));
        },
        { sleepImpl: noSleep, maxAttempts: 3 },
      ),
    ).rejects.toThrow('failure 3');

    expect(calls).toBe(3);
  });

  it('preserves the error identity so callers can branch on it', async () => {
    const original = Object.assign(new Error('nope'), { code: 'ENOTFOUND' });

    await expect(
      retryWithBackoff(() => Promise.reject(original), {
        sleepImpl: noSleep,
        maxAttempts: 2,
      }),
    ).rejects.toBe(original);
  });

  it('fails fast when shouldRetry declines', async () => {
    let calls = 0;
    const sleeps: number[] = [];

    await expect(
      retryWithBackoff(
        () => {
          calls += 1;
          return Promise.reject(new Error('permanent'));
        },
        {
          sleepImpl: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
          },
          shouldRetry: () => false,
        },
      ),
    ).rejects.toThrow('permanent');

    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('reports every failed attempt to onAttemptError', async () => {
    const seen: string[] = [];

    await expect(
      retryWithBackoff(
        (attempt) => Promise.reject(new Error(`boom ${attempt}`)),
        {
          sleepImpl: noSleep,
          maxAttempts: 3,
          onAttemptError: (error, attempt) =>
            seen.push(`${attempt}:${(error as Error).message}`),
        },
      ),
    ).rejects.toThrow('boom 3');

    expect(seen).toEqual(['1:boom 1', '2:boom 2', '3:boom 3']);
  });
});
