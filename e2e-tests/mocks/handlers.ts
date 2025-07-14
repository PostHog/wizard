import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('https://us.posthog.com/api/wizard/initialize', () => {
    return HttpResponse.json({
      hash: 'mock-wizard-hash-123',
    });
  }),

  http.get('https://us.posthog.com/api/wizard/data', ({ request }) => {
    const wizardHash = request.headers.get('X-PostHog-Wizard-Hash');
    if (wizardHash === 'mock-wizard-hash-123') {
      return HttpResponse.json({
        project_api_key: 'mock-project-api-key',
        host: 'https://app.posthog.com',
        user_distinct_id: 'mock-user-id',
        personal_api_key: 'mock-personal-api-key',
      });
    }
    return HttpResponse.json({ error: 'Invalid wizard hash' }, { status: 401 });
  }),
];
