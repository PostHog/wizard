import {
  formatSdkMessageForLog,
  MAX_LOG_FIELD_CHARS,
} from '@lib/agent/sdk-message-log';

describe('formatSdkMessageForLog', () => {
  it('truncates a 100 KB tool_result so the formatted line stays ≤ 8 KB', () => {
    const big = 'x'.repeat(100 * 1024);
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: big,
          },
        ],
      },
    };

    const formatted = formatSdkMessageForLog(message);

    expect(Buffer.byteLength(formatted, 'utf8')).toBeLessThanOrEqual(8 * 1024);
    expect(formatted).toContain('[truncated');
    expect(formatted).toContain('tool_result');
    expect(formatted).toContain('"type":"user"');
    expect(formatted).toContain(String(100 * 1024));
  });

  it('does not mutate the original message', () => {
    const message = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            content: 'a'.repeat(MAX_LOG_FIELD_CHARS + 100),
          },
        ],
      },
    };
    const before = JSON.stringify(message);
    formatSdkMessageForLog(message);
    expect(JSON.stringify(message)).toBe(before);
  });

  it('preserves short API error strings in result messages', () => {
    const msg = 'API Error: 401 {"detail":"Authentication required"}';
    const formatted = formatSdkMessageForLog({
      type: 'result',
      is_error: true,
      result: msg,
    });
    expect(formatted).toContain('API Error: 401');
    expect(formatted).not.toContain('[truncated');
  });

  it('uses compact JSON (no pretty-print whitespace)', () => {
    const formatted = formatSdkMessageForLog({ type: 'assistant', ok: true });
    expect(formatted).not.toContain('\n');
    expect(formatted).toBe('{"type":"assistant","ok":true}');
  });
});
