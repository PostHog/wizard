const { mockProvisionNewAccount } = vi.hoisted(() => ({
  mockProvisionNewAccount: vi.fn(),
}));

vi.mock(import('@utils/provisioning'), () => ({
  provisionNewAccount: mockProvisionNewAccount,
}));

import type { ConsoleLog } from '@shared/console-log';
import { runProvision } from '../index';

const log = {
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
} as unknown as ConsoleLog;
const args = {
  email: 'new@example.com',
  region: 'US' as const,
  name: '',
  jsonMode: true,
};

// `provision` is scripted: the code is the whole result.
describe('runProvision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('resolves 0 once the account exists', async () => {
    mockProvisionNewAccount.mockResolvedValue({ projectApiKey: 'phc_x' });
    await expect(runProvision(args, { log })).resolves.toBe(0);
  });

  it('resolves 1 when provisioning rejects', async () => {
    mockProvisionNewAccount.mockRejectedValue(new Error('network fail'));
    await expect(runProvision(args, { log })).resolves.toBe(1);
  });
});
