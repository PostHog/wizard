import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCiInferenceAuthProvider } from '../ci-inference-auth';

describe('CI inference credentials', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'wizard-ci-inference-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads the required bearer file once and returns a fixed provider', async () => {
    const tokenFile = join(directory, 'gateway-token');
    writeFileSync(tokenFile, ' opaque-fixture-bearer \n');
    vi.stubEnv('WIZARD_CI_GATEWAY_TOKEN_FILE', tokenFile);

    const provider = loadCiInferenceAuthProvider(42, 'us');
    expect(process.env.WIZARD_CI_GATEWAY_TOKEN_FILE).toBeUndefined();
    rmSync(tokenFile);

    const auth = {
      token: 'opaque-fixture-bearer',
      teamId: 42,
      gatewayUrl: 'https://ai-gateway.us.posthog.com',
      refreshAtMs: Infinity,
    };
    expect(await provider.resolve()).toEqual(auth);
    expect(await provider.resolve()).toEqual(auth);
  });

  it('requires the token file and rejects an untrusted gateway override', () => {
    vi.stubEnv('WIZARD_CI_GATEWAY_TOKEN_FILE', '');
    expect(() => loadCiInferenceAuthProvider(42, 'us')).toThrow(
      'WIZARD_CI_GATEWAY_TOKEN_FILE is required',
    );

    const tokenFile = join(directory, 'gateway-token');
    writeFileSync(tokenFile, 'fixture-token');
    vi.stubEnv('WIZARD_CI_GATEWAY_TOKEN_FILE', tokenFile);
    vi.stubEnv('WIZARD_CI_GATEWAY_URL', 'https://untrusted.example');
    expect(() => loadCiInferenceAuthProvider(42, 'us')).toThrow(
      'trusted gateway origin',
    );
  });
});
