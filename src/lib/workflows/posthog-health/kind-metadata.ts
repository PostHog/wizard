// Keep in sync with posthog/posthog/api/health_issue.py — see the
// `kind` serializer docstring for the canonical list.

import { POSTHOG_DOCS_URL } from '../../constants';

export interface KindMeta {
  title: string;
  description: string;
  docsUrl: string;
}

export const KIND_METADATA: Record<string, KindMeta> = {
  ingestion_lag: {
    title: 'Ingestion is delayed',
    description:
      'Events are being received but are taking longer than usual to appear.',
    docsUrl: `${POSTHOG_DOCS_URL}/support/troubleshooting`,
  },
  ingestion_warning: {
    title: 'Ingestion warnings on recent events',
    description:
      'Some recent events were rejected or flagged by the ingestion pipeline.',
    docsUrl: `${POSTHOG_DOCS_URL}/support/troubleshooting`,
  },
  sdk_outdated: {
    title: 'SDK version is out of date',
    description:
      'One or more SDKs are running an old version. Upgrade to get the latest fixes.',
    docsUrl: `${POSTHOG_DOCS_URL}/libraries`,
  },
  no_live_events: {
    title: 'No $pageview or $screen events in the last 30 days',
    description:
      'PostHog is not receiving page or screen events from this project.',
    docsUrl: `${POSTHOG_DOCS_URL}/getting-started/install`,
  },
  no_pageleave_events: {
    title: '$pageleave events not being sent',
    description:
      'Enable pageleave tracking to power bounce rate and session duration.',
    docsUrl: `${POSTHOG_DOCS_URL}/libraries/js#config`,
  },
  scroll_depth: {
    title: 'Scroll depth tracking disabled',
    description:
      'Turn on scroll depth to capture how far users read each page.',
    docsUrl: `${POSTHOG_DOCS_URL}/libraries/js#config`,
  },
  authorized_urls: {
    title: 'No authorized URLs configured',
    description:
      'Some web analytics filters require at least one authorized URL to work.',
    docsUrl: `${POSTHOG_DOCS_URL}/web-analytics/faq`,
  },
  reverse_proxy: {
    title: 'No reverse proxy detected',
    description: 'A reverse proxy reduces data loss from ad blockers.',
    docsUrl: `${POSTHOG_DOCS_URL}/advanced/proxy`,
  },
  web_vitals: {
    title: 'Web Vitals tracking disabled',
    description:
      'Enable Web Vitals to capture LCP, CLS and other performance metrics.',
    docsUrl: `${POSTHOG_DOCS_URL}/web-analytics/web-vitals`,
  },
  materialized_view_failure: {
    title: 'A materialized view is failing',
    description: 'A data modeling pipeline failed its most recent run.',
    docsUrl: `${POSTHOG_DOCS_URL}/data-warehouse`,
  },
  external_data_failure: {
    title: 'External data source is failing',
    description: 'An external data source sync failed and data may be stale.',
    docsUrl: `${POSTHOG_DOCS_URL}/data-warehouse/sources`,
  },
};

export const UNKNOWN_KIND_META: KindMeta = {
  title: 'Unknown issue',
  description:
    'PostHog reported an issue kind the wizard does not yet recognize.',
  docsUrl: POSTHOG_DOCS_URL,
};

export function getKindMeta(kind: string): KindMeta {
  return KIND_METADATA[kind] ?? { ...UNKNOWN_KIND_META, title: kind };
}
