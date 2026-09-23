import type { RunConfig, RunInput } from '@agent/runner';

const gatewayUrl = process.env.WIZARD_FAULT_GATEWAY_URL;
const installDir = process.env.WIZARD_FAULT_INSTALL_DIR;
const harness = process.env.WIZARD_FAULT_HARNESS;
if (
  !gatewayUrl ||
  !installDir ||
  !['anthropic', 'pi'].includes(harness ?? '')
) {
  throw new Error(
    'Expected WIZARD_FAULT_GATEWAY_URL, WIZARD_FAULT_INSTALL_DIR, and WIZARD_FAULT_HARNESS',
  );
}

const routedFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === 'internal-j.posthog.com') {
    return Promise.resolve(new Response('{"status":1}', { status: 200 }));
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    return Promise.reject(
      new Error('Fault probe blocked a non-loopback fetch'),
    );
  }
  return routedFetch(input, init);
};

const { runAgent } = await import('@agent/runner');
const { configureGatewayCredentialsForCI } = await import(
  '@agent/gateway-session'
);
const { DEFAULT_AGENT_MODEL, Harness, Sequence } = await import(
  '@shared/constants'
);
const { HostResolution } = await import('@shared/host-resolution');
const { analytics } = await import('@utils/analytics');

// This probe has no telemetry sink and uses only synthetic local credentials.
analytics.capture = () => {};
analytics.captureException = () => {};
analytics.wizardCapture = () => {};
analytics.shutdown = async () => {};

configureGatewayCredentialsForCI(
  'phe_synthetic_fault_probe',
  228144,
  gatewayUrl,
);

const config: RunConfig = {
  programId: 'fault-probe',
  run: {
    integrationLabel: 'Fault probe',
    spinnerMessage: 'Running fault probe',
    successMessage: 'Fault probe completed',
    estimatedDurationMinutes: 1,
    reportFile: 'fault-probe.md',
    docsUrl: 'https://posthog.com/docs',
    customPrompt: () => 'Answer briefly without using tools.',
  },
  composed: false,
  binding: {
    sequence: Sequence.linear,
    harness: harness as Harness,
    model: DEFAULT_AGENT_MODEL,
  },
  switchboard: {
    program: 'fault-probe',
    flags: {},
    cliHarness: harness as Harness,
  },
  skillsBaseUrl: 'http://127.0.0.1:1',
  wizardFlags: {},
  wizardFlagPayloads: {},
  wizardMetadata: { run_id: 'fault-probe' },
};

const input: RunInput = {
  installDir,
  credentials: {
    accessToken: 'phx_synthetic_fault_probe',
    projectApiKey: 'phc_synthetic_fault_probe',
    host: HostResolution.fromApiHost('http://127.0.0.1:1', { localMcp: true }),
    projectId: 228144,
  },
  project: null,
  apiUser: null,
  flags: {
    ci: true,
    signup: false,
    debug: false,
    e2eAsk: false,
    localMcp: true,
    captureAio: false,
    benchmark: false,
    yaraReport: false,
  },
  host: { projectId: 228144, region: 'us' },
};

const result = await runAgent(config, input);
process.stdout.write(
  `WIZARD_FAULT_RESULT ${JSON.stringify({
    harness,
    outcome: result.outcome,
    code: result.failure?.code,
    message: result.failure?.message,
    hasError: result.failure?.error instanceof Error,
    outroKind: result.outro?.kind,
  })}\n`,
);
if (result.outcome === 'failed' || result.outcome === 'aborted') {
  const { wizardAbort } = await import('@utils/wizard-abort');
  await wizardAbort(result.failure);
} else {
  process.exitCode = 2;
}
