import axios from 'axios';
import {
  ProvisionedAccountUnreadableError,
  provisionNewAccount,
} from '@utils/provisioning';
import { analytics } from '../analytics';
// Fixtures live outside `__tests__` on purpose: every `.ts` in there is collected as a
// test suite.
import {
  ACCOUNT_REQUEST_RESPONSE,
  RESOURCE_READBACK_RESPONSE,
  RESOURCE_RESPONSE,
  TOKEN_RESPONSE,
} from '../__fixtures__/provisioning';

vi.mock('axios');
// Return the override verbatim so region-based prod routing applies (no IS_DEV
// localhost); undefined means no override.
vi.mock('../urls', () => ({
  resolveBaseUrl: (baseUrl?: string) => baseUrl,
}));
vi.mock('../debug', () => ({ logToFile: vi.fn() }));
vi.mock('../analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const mockedAxios = axios as Mocked<typeof axios>;

describe('provisionNewAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Recorded responses, not hand-written ones: the flow has to pass against what the
  // API actually sends today.
  it('completes the full PKCE flow against the recorded API responses', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: ACCOUNT_REQUEST_RESPONSE })
      .mockResolvedValueOnce({ data: TOKEN_RESPONSE })
      .mockResolvedValueOnce({ data: RESOURCE_RESPONSE });

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
      accessToken: 'pha_recorded_access',
      refreshToken: 'phr_recorded_refresh',
      projectApiKey: 'phc_recorded',
      host: 'https://us.posthog.com',
      personalApiKey: 'phx_recorded',
      projectId: '4242',
      accountId: 'org_recorded',
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
      'event_definition:write',
      'replay_scanner:read',
      'replay_scanner:write',
      'session_recording:read',
      'product_enablement:write',
    ]);

    // Verify token exchange includes code_verifier
    const tokenCall = mockedAxios.post.mock.calls[1];
    expect(tokenCall[0]).toContain('/oauth/token');
    expect(tokenCall[1]).toContain('code_verifier=');
    expect(tokenCall[1]).toContain('grant_type=authorization_code');

    // Verify resources call uses bearer token and project name
    const resourceCall = mockedAxios.post.mock.calls[2];
    expect(resourceCall[0]).toContain('/resources');
    expect(resourceCall[1]).toEqual({
      configuration: { project_name: 'my-app' },
    });
    expect(resourceCall[2]?.headers?.Authorization).toBe(
      'Bearer pha_recorded_access',
    );
  });

  // Forward compatibility: the API is free to add fields. Only a field the wizard reads
  // may ever fail the flow.
  it('ignores unknown fields the API adds to its responses', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: { ...ACCOUNT_REQUEST_RESPONSE, future_field: 'whatever' },
      })
      .mockResolvedValueOnce({
        data: { ...TOKEN_RESPONSE, scope: 'a b c', issued_at: 123 },
      })
      .mockResolvedValueOnce({
        data: {
          ...RESOURCE_RESPONSE,
          service_id: 'analytics',
          billing: { plan: 'free' },
        },
      });

    await expect(
      provisionNewAccount('forward@example.com', ''),
    ).resolves.toMatchObject({ projectApiKey: 'phc_recorded' });
  });

  it('reads the resource back when the create response is unreadable', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: ACCOUNT_REQUEST_RESPONSE })
      .mockResolvedValueOnce({ data: TOKEN_RESPONSE })
      // Drift in a field the wizard does consume. The project exists regardless, so the
      // flow must recover from it rather than abandon a provisioned account.
      .mockResolvedValueOnce({
        data: {
          status: 'complete',
          id: '4242',
          complete: {
            access_configuration: { host: 'https://us.posthog.com' },
          },
        },
      });
    mockedAxios.get.mockResolvedValueOnce({
      data: RESOURCE_READBACK_RESPONSE,
    });

    const result = await provisionNewAccount('readback@example.com', '');

    expect(result).toMatchObject({
      projectApiKey: 'phc_recorded',
      projectId: '4242',
      // The detail endpoint never mints a PAT, so recovery legitimately loses it.
      personalApiKey: undefined,
    });

    const readbackCall = mockedAxios.get.mock.calls[0];
    expect(readbackCall[0]).toContain('/provisioning/resources/4242');
    expect(readbackCall[1]?.headers?.Authorization).toBe(
      'Bearer pha_recorded_access',
    );

    // The drift is reported even though the flow recovered — otherwise the next one is
    // invisible until someone reads the code.
    expect(analytics.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        step: 'provisioning_resources',
        issue_paths: ['complete.access_configuration.api_key'],
      }),
    );
  });

  it('reports the rejected paths when the resource cannot be read at all', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: ACCOUNT_REQUEST_RESPONSE })
      .mockResolvedValueOnce({ data: TOKEN_RESPONSE })
      .mockResolvedValueOnce({ data: { status: 'complete' } });
    mockedAxios.get.mockRejectedValueOnce(new Error('500'));

    const error = await provisionNewAccount('unreadable@example.com', '').catch(
      (e: unknown) => e,
    );

    // The account exists — the error has to say so, or the caller sends the user off to
    // sign up a second time.
    expect(error).toBeInstanceOf(ProvisionedAccountUnreadableError);
    expect((error as ProvisionedAccountUnreadableError).accountCreated).toBe(
      true,
    );
    expect(analytics.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        step: 'provisioning_resources',
        issue_paths: ['id'],
      }),
    );
  });

  it('throws the controlled error when provisioning reports it is not complete', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: ACCOUNT_REQUEST_RESPONSE })
      .mockResolvedValueOnce({ data: TOKEN_RESPONSE })
      // A readable response that simply isn't done — distinct from drift, and not
      // something a read-back would fix.
      .mockResolvedValueOnce({ data: { status: 'error', id: '4242' } });

    await expect(
      provisionNewAccount('incomplete@example.com', ''),
    ).rejects.toThrow('did not complete');
    expect(mockedAxios.get).not.toHaveBeenCalled();
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
        data: { status: 'error', id: '0' },
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

    // EU provisioning must target the EU host with the EU client, and every
    // follow-up call (token exchange, resources) stays on the EU host.
    for (const call of mockedAxios.post.mock.calls) {
      expect(call[0]).toContain('https://eu.posthog.com');
    }
    expect((accountCall[1] as Record<string, unknown>).client_id).toBe(
      'bx2C5sZRN03TkdjraCcetvQFPGH6N2Y9vRLkcKEy',
    );
  });

  it('routes US provisioning to the US host and client', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: { id: 'req_us', type: 'oauth', oauth: { code: 'code_us' } },
      })
      .mockResolvedValueOnce({
        data: {
          token_type: 'bearer',
          access_token: 'pha_us',
          refresh_token: 'phr_us',
          expires_in: 3600,
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: 'complete',
          id: '7',
          complete: {
            access_configuration: {
              api_key: 'phc_us',
              host: 'https://us.posthog.com',
            },
          },
        },
      });

    await provisionNewAccount('us@example.com', '', 'US');

    for (const call of mockedAxios.post.mock.calls) {
      expect(call[0]).toContain('https://us.posthog.com');
    }
    const accountCall = mockedAxios.post.mock.calls[0];
    expect((accountCall[1] as Record<string, unknown>).client_id).toBe(
      'c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM',
    );
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
    expect(resourceCall[1]).toEqual({
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
    expect(resourceCall[1]).toEqual({});
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
