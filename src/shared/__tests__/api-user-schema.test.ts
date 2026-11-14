import { ApiUserSchema } from '../api';

vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

describe('ApiUserSchema', () => {
  it('parses a user whose current project and organization the credential cannot reach', () => {
    const user = ApiUserSchema.parse({
      distinct_id: 'user-1',
      team: null,
      organization: null,
      organizations: [],
    });

    expect(user.team).toBeNull();
    expect(user.organization).toBeNull();
  });
});
