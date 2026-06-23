import { AgentOutputSignals } from '@lib/agent/output-signals';

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
    expect(signals.hasYaraViolation()).toBe(false);
    expect(signals.remark()).toBeUndefined();
  });

  it('treats the API error status as a parameter, not a fixed marker', () => {
    const signals = new AgentOutputSignals();
    signals.push('API Error: 503 service unavailable');

    expect(signals.hasApiError()).toBe(true); // generic match via the prefix
    expect(signals.hasApiErrorStatus(503)).toBe(true);
    expect(signals.hasApiErrorStatus(500)).toBe(false);
  });

  it('detects a transient provisioning 403 from the Bedrock fallback', () => {
    const invalidPayment = new AgentOutputSignals();
    invalidPayment.push(
      'API Error: 403 Model access is denied due to INVALID_PAYMENT_INSTRUMENT',
    );
    expect(invalidPayment.hasProvisioningError()).toBe(true);

    const marketplace = new AgentOutputSignals();
    marketplace.push(
      'API Error: 403 Your AWS Marketplace subscription for this model cannot be completed',
    );
    expect(marketplace.hasProvisioningError()).toBe(true);
  });

  it('does not treat other 403s or other statuses as provisioning errors', () => {
    const forbidden = new AgentOutputSignals();
    forbidden.push('API Error: 403 Forbidden: insufficient permissions');
    expect(forbidden.hasProvisioningError()).toBe(false);

    // The billing keywords on a non-403 status must not match either.
    const wrongStatus = new AgentOutputSignals();
    wrongStatus.push('API Error: 500 INVALID_PAYMENT_INSTRUMENT');
    expect(wrongStatus.hasProvisioningError()).toBe(false);
  });

  it('detects YARA violations from either marker', () => {
    const critical = new AgentOutputSignals();
    critical.push('[YARA CRITICAL] prompt injection detected');
    expect(critical.hasYaraViolation()).toBe(true);

    const scannerErr = new AgentOutputSignals();
    scannerErr.push('[YARA] Scanner error: failed to load rules');
    expect(scannerErr.hasYaraViolation()).toBe(true);
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
});
