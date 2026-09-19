/**
 * Responses recorded from the live agentic provisioning API, kept in one place so the
 * suite can't drift back into asserting a shape the API stopped sending.
 *
 * The `service_id` incident is the reason this file exists: the old fixtures were
 * hand-written with a `service_id` field the wizard required, so the suite stayed green
 * while every real signup crashed. Refresh these against a real run (`wizard provision
 * --json`) rather than editing them to make a test pass.
 */

export const ACCOUNT_REQUEST_RESPONSE = {
  id: 'req_recorded',
  type: 'oauth',
  oauth: { code: 'recorded_auth_code' },
} as const;

export const TOKEN_RESPONSE = {
  token_type: 'bearer',
  access_token: 'pha_recorded_access',
  refresh_token: 'phr_recorded_refresh',
  expires_in: 31536000,
  account: {
    id: 'org_recorded',
    payment_credentials: 'orchestrator',
    available_teams: [
      {
        id: 4242,
        name: 'my-app',
        organization_id: 'org_recorded',
        organization_name: 'acme',
      },
    ],
  },
} as const;

/** `POST /api/agentic/provisioning/resources` — no `service_id` since 2026-07-27. */
export const RESOURCE_RESPONSE = {
  status: 'complete',
  id: '4242',
  complete: {
    access_configuration: {
      api_key: 'phc_recorded',
      host: 'https://us.posthog.com',
      personal_api_key: 'phx_recorded',
    },
  },
} as const;

/** `GET /api/agentic/provisioning/resources/:id` — never mints a personal API key. */
export const RESOURCE_READBACK_RESPONSE = {
  status: 'complete',
  id: '4242',
  complete: {
    access_configuration: {
      api_key: 'phc_recorded',
      host: 'https://us.posthog.com',
    },
  },
} as const;
