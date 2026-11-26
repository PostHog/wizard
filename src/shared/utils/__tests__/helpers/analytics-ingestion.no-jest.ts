/** A stand-in for PostHog ingestion that records what the Wizard's real analytics client sends it. */
import { gunzipSync } from 'zlib';
import { vi } from 'vitest';
import { ANALYTICS_HOST_URL } from '@shared/constants';

export type IngestedEvent = {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
};

export type Ingestion = {
  events: IngestedEvent[];
  /** Answers each batch; resolve late or never to model a slow or stalled ingestion. */
  respond: () => Promise<Response>;
};

async function readBatch(body: unknown): Promise<IngestedEvent[]> {
  const bytes = Buffer.from(
    await new Response(
      body as ConstructorParameters<typeof Response>[0],
    ).arrayBuffer(),
  );
  const text = (
    bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
  ).toString('utf8');
  return (JSON.parse(text) as { batch: IngestedEvent[] }).batch;
}

export const accepted = (): Promise<Response> =>
  Promise.resolve(
    new Response('{"results":{}}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

export function recordAnalyticsIngestion(): Ingestion {
  const ingestion: Ingestion = { events: [], respond: accepted };
  const realFetch = global.fetch;
  vi.stubGlobal(
    'fetch',
    async (...[input, init]: Parameters<typeof fetch>): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== ANALYTICS_HOST_URL) return realFetch(input, init);
      if (!url.pathname.startsWith('/i/v1/analytics/events')) return accepted();
      const response = await ingestion.respond();
      if (response.ok) ingestion.events.push(...(await readBatch(init?.body)));
      return response;
    },
  );
  return ingestion;
}
