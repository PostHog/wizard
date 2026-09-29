import { readCiGatewayCredential } from '@shared/ci-gateway';

describe('readCiGatewayCredential', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('requires an explicit gateway token file for CI', () => {
    vi.stubEnv('WIZARD_CI_GATEWAY_TOKEN_FILE', '');
    expect(() => readCiGatewayCredential('us')).toThrow(
      'WIZARD_CI_GATEWAY_TOKEN_FILE is required',
    );
  });
});
