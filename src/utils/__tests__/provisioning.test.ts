import axios from 'axios';
import { provisionNewAccount } from '@utils/provisioning';

vi.mock('axios');
vi.mock('../debug', () => ({ logToFile: vi.fn() }));
vi.mock('../analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const mockedAxios = axios as Mocked<typeof axios>;

describe('provisionNewAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes the full PKCE flow and returns credentials', async () => {
    // Step 1: account_requests
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        id: 'req_1',
        type: 'oauth',
        oauth: { code: 'test_code_123' },
      },
    });

    // Step 2: oauth/token
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        token_type: 'bearer',
        access_token: 'pha_test_access',
        refresh_token: 'phr_test_refresh',
        expires_in: 3600,
        account: { id: 'org_123' },
      },
    });

    // Step 3: resources
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        status: 'complete',
        id: '42',
        service_id: 'analytics',
        complete: {
          access_configuration: {
            api_key: 'phc_test_key',
            host: 'https://us.posthog.com',
            personal_api_key: 'phx_test_pat',
          },
        },
      },
    });

    const result = await provisionNewAccount(
      'user@example.com',
      'Test User',
      'US',
      {
        orgName: 'acme-corp',
        projectName: 'my-app',
      },
    );

    expect(result).toEqual({
      accessToken: 'pha_test_access',
      refreshToken: 'phr_test_refresh',
      projectApiKey: 'phc_test_key',
      host: 'https://us.posthog.com',
      personalApiKey: 'phx_test_pat',
      projectId: '42',
      accountId: 'org_123',
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(3);

    // Verify account_requests call
    const accountCall = mockedAxios.post.mock.calls[0];
    expect(accountCall[0]).toContain('/account_requests');
    expect(accountCall[1]).toMatchObject({
      email: 'user@example.com',
      name: 'Test User',
      code_challenge_method: 'S256',
      configuration: {
        region: 'US',
        organization_name: 'acme-corp',
      },
    });
    expect(
      (accountCall[1] as Record<string, unknown>).code_challenge,
    ).toBeTruthy();
    expect((accountCall[1] as Record<string, unknown>).client_id).toBeTruthy();
    expect((accountCall[1] as Record<string, unknown>).scopes).toEqual([
      'user:read',
      'project:read',
      'llm_gateway:read',
      'dashboard:write',
      'insight:write',
      'query:read',
      'notebook:write',
    ]);

    // Verify token exchange includes code_verifier
    const tokenCall = mockedAxios.post.mock.calls[1];
    expect(tokenCall[0]).toContain('/oauth/token');
    expect(tokenCall[1]).toContain('code_verifier=');
    expect(tokenCall[1]).toContain('grant_type=authorization_code');

    // Verify resources call uses bearer token and project name
    const resourceCall = mockedAxios.post.mock.calls[2];
    expect(resourceCall[0]).toContain('/resources');
    expect(resourceCall[1]).toMatchObject({
      service_id: 'analytics',
      configuration: { project_name: 'my-app' },
    });
    expect(resourceCall[2]?.headers?.Authorization).toBe(
      'Bearer pha_test_access',
    );
  });

  it('throws when account already exists', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        id: 'req_2',
        type: 'requires_auth',
        requires_auth: { type: 'redirect', redirect: { url: 'https://...' } },
      },
    });

    await expect(
      provisionNewAccount('existing@example.com', ''),
    ).rejects.toThrow('already associated');
  });

  it('throws on API error response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        id: 'req_3',
        type: 'error',
        error: { code: 'forbidden', message: 'Account creation disabled' },
      },
    });

    await expect(
      provisionNewAccount('blocked@example.com', ''),
    ).rejects.toThrow('Account creation disabled');
  });

  it('throws when resource provisioning fails', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: { id: 'req_4', type: 'oauth', oauth: { code: 'code_4' } },
      })
      .mockResolvedValueOnce({
        data: {
          token_type: 'bearer',
          access_token: 'pha_4',
          refresh_token: 'phr_4',
          expires_in: 3600,
        },
      })
      .mockResolvedValueOnce({
        data: { status: 'error', id: '0', service_id: 'analytics' },
      });

    await expect(provisionNewAccount('fail@example.com', '')).rejects.toThrow(
      'did not complete',
    );
  });

  it('sends correct region parameter', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: { id: 'req_5', type: 'oauth', oauth: { code: 'code_5' } },
      })
      .mockResolvedValueOnce({
        data: {
          token_type: 'bearer',
          access_token: 'pha_5',
          refresh_token: 'phr_5',
          expires_in: 3600,
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: 'complete',
          id: '99',
          service_id: 'analytics',
          complete: {
            access_configuration: {
              api_key: 'phc_eu',
              host: 'https://eu.posthog.com',
            },
          },
        },
      });

    const result = await provisionNewAccount('eu@example.com', '', 'EU');

    const accountCall = mockedAxios.post.mock.calls[0];
    expect((accountCall[1] as Record<string, unknown>).configuration).toEqual({
      region: 'EU',
    });
    expect(result.host).toBe('https://eu.posthog.com');
  });

  it('sends project name in resources configuration', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: { id: 'req_p', type: 'oauth', oauth: { code: 'code_p' } },
      })
      .mockResolvedValueOnce({
        data: {
          token_type: 'bearer',
          access_token: 'pha_p',
          refresh_token: 'phr_p',
          expires_in: 3600,
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: 'complete',
          id: '50',
          service_id: 'analytics',
          complete: {
            access_configuration: {
              api_key: 'phc_p',
              host: 'https://us.posthog.com',
            },
          },
        },
      });

    await provisionNewAccount('proj@example.com', '', 'US', {
      projectName: 'my-cool-app',
    });

    const resourceCall = mockedAxios.post.mock.calls[2];
    expect(resourceCall[1]).toMatchObject({
      service_id: 'analytics',
      configuration: { project_name: 'my-cool-app' },
    });
  });

  it('omits project name when not provided', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: { id: 'req_np', type: 'oauth', oauth: { code: 'code_np' } },
      })
      .mockResolvedValueOnce({
        data: {
          token_type: 'bearer',
          access_token: 'pha_np',
          refresh_token: 'phr_np',
          expires_in: 3600,
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: 'complete',
          id: '51',
          service_id: 'analytics',
          complete: {
            access_configuration: {
              api_key: 'phc_np',
              host: 'https://us.posthog.com',
            },
          },
        },
      });

    await provisionNewAccount('noproj@example.com', '');

    const resourceCall = mockedAxios.post.mock.calls[2];
    expect(resourceCall[1]).toEqual({ service_id: 'analytics' });
  });

  it('includes timeouts on all requests', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: { id: 'req_6', type: 'oauth', oauth: { code: 'code_6' } },
      })
      .mockResolvedValueOnce({
        data: {
          token_type: 'bearer',
          access_token: 'pha_6',
          refresh_token: 'phr_6',
          expires_in: 3600,
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: 'complete',
          id: '1',
          service_id: 'analytics',
          complete: {
            access_configuration: {
              api_key: 'phc_t',
              host: 'https://us.posthog.com',
            },
          },
        },
      });

    await provisionNewAccount('timeout@example.com', '');

    // account_requests and resources have config at index 2
    const accountConfig = mockedAxios.post.mock.calls[0][2] as
      | Record<string, unknown>
      | undefined;
    const resourceConfig = mockedAxios.post.mock.calls[2][2] as
      | Record<string, unknown>
      | undefined;
    expect(accountConfig?.timeout).toBe(30_000);
    expect(resourceConfig?.timeout).toBe(30_000);
    // token exchange has config at index 2 (URL-encoded body is at index 1)
    const tokenConfig = mockedAxios.post.mock.calls[1][2] as
      | Record<string, unknown>
      | undefined;
    expect(tokenConfig?.timeout).toBe(30_000);
  });
});
