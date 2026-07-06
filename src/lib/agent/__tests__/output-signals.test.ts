import { AgentOutputSignals } from '@lib/agent/output-signals';
import { AgentSignals, REMARK_INSTRUCTION } from '@lib/agent/signals';

describe('REMARK_INSTRUCTION', () => {
  it('carries the marker but no literal placeholder a model could echo', () => {
    // gpt-5-mini echoed "Your remark here" verbatim from the old wording.
    expect(REMARK_INSTRUCTION).toContain(AgentSignals.WIZARD_REMARK);
    expect(REMARK_INSTRUCTION).not.toMatch(/your remark here/i);
  });

  it('drops a remark that merely echoes the instruction', () => {
    // Field bug twice over: gpt-5-mini replied with whatever trailed the
    // marker in the format clause. Any instruction substring is an echo.
    const echoed = REMARK_INSTRUCTION.split(AgentSignals.WIZARD_REMARK)[1]
      .trim()
      .slice(0, 40);
    const signals = new AgentOutputSignals();
    signals.push(`${AgentSignals.WIZARD_REMARK} ${echoed}`);
    expect(signals.remark()).toBeUndefined();
  });

  it('keeps a genuine remark', () => {
    const signals = new AgentOutputSignals();
    signals.push(
      `${AgentSignals.WIZARD_REMARK} The Astro skill lacked hybrid-render env var docs.`,
    );
    expect(signals.remark()).toBe(
      'The Astro skill lacked hybrid-render env var docs.',
    );
  });
});

describe('AgentOutputSignals', () => {
  it('drops prose but detects each signal marker', () => {
    const signals = new AgentOutputSignals();
    signals.push('Thinking about the integration plan...'); // prose, dropped
    signals.push('Reading files and editing config'); // prose, dropped
    signals.push('Hit a wall. API Error: 401 unauthorized');
    signals.push('[ERROR-MCP-MISSING] could not reach MCP');

    expect(signals.hasApiError()).toBe(true);
    expect(signals.hasApiErrorStatus(401)).toBe(true);
    expect(signals.hasApiErrorStatus(429)).toBe(false);
    expect(signals.has('MCP_MISSING')).toBe(true);
    expect(signals.has('RESOURCE_MISSING')).toBe(false);
    expect(signals.remark()).toBeUndefined();
  });

  it('treats the API error status as a parameter, not a fixed marker', () => {
    const signals = new AgentOutputSignals();
    signals.push('API Error: 503 service unavailable');

    expect(signals.hasApiError()).toBe(true); // generic match via the prefix
    expect(signals.hasApiErrorStatus(503)).toBe(true);
    expect(signals.hasApiErrorStatus(500)).toBe(false);
  });

  it('extracts only the API Error lines for the message', () => {
    const signals = new AgentOutputSignals();
    signals.push('Some prose before the error');
    signals.push('Request failed: API Error: 429 rate limited, retry later');

    expect(signals.hasApiErrorStatus(429)).toBe(true);
    expect(signals.apiErrorMessage()).toBe(
      'API Error: 429 rate limited, retry later',
    );
  });

  it('extracts the trimmed remark after the marker', () => {
    const signals = new AgentOutputSignals();
    signals.push(
      'Done. [WIZARD-REMARK] The MCP schema was larger than expected.',
    );

    expect(signals.remark()).toBe('The MCP schema was larger than expected.');
  });

  it('returns undefined extractions when no matching lines were retained', () => {
    const signals = new AgentOutputSignals();
    signals.push('Nothing interesting here');

    expect(signals.apiErrorMessage()).toBeUndefined();
    expect(signals.remark()).toBeUndefined();
  });

  describe('apiKeySource', () => {
    it('flags a stored "/login managed key" as a managed login', () => {
      const signals = new AgentOutputSignals();
      signals.recordApiKeySource('/login managed key');

      expect(signals.apiKeySource).toBe('/login managed key');
      expect(signals.usedManagedLogin()).toBe(true);
    });

    it('does not flag an explicit API key as a managed login', () => {
      const signals = new AgentOutputSignals();
      signals.recordApiKeySource('ANTHROPIC_API_KEY');

      expect(signals.usedManagedLogin()).toBe(false);
    });

    it('is absent (and not a managed login) when never recorded', () => {
      const signals = new AgentOutputSignals();

      expect(signals.apiKeySource).toBeUndefined();
      expect(signals.usedManagedLogin()).toBe(false);
    });

    it('ignores an undefined source so a later real value can win', () => {
      const signals = new AgentOutputSignals();
      signals.recordApiKeySource(undefined);
      expect(signals.apiKeySource).toBeUndefined();

      signals.recordApiKeySource('/login managed key');
      expect(signals.usedManagedLogin()).toBe(true);
    });
  });
});
