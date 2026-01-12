import z from 'zod';
import type { CloudRegion } from '../../utils/types';

export const DefaultMCPClientConfig = z
  .object({
    mcpServers: z.record(
      z.string(),
      z.union([
        z.object({
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
        }),
        z.object({
          url: z.string(),
          headers: z.record(z.string(), z.string()).optional(),
        }),
      ]),
    ),
  })
  .passthrough();

export const AVAILABLE_FEATURES = {
  'Data & Analytics': [
    {
      value: 'dashboards',
      label: 'Dashboards',
      hint: 'Dashboard creation and management',
    },
    {
      value: 'insights',
      label: 'Insights',
      hint: 'Analytics insights and SQL queries',
    },
    {
      value: 'experiments',
      label: 'Experiments',
      hint: 'A/B testing experiments',
    },
    {
      value: 'llm-analytics',
      label: 'LLM Analytics',
      hint: 'LLM usage and cost tracking',
    },
  ],
  'Development Tools': [
    {
      value: 'error-tracking',
      label: 'Error Tracking',
      hint: 'Error monitoring and debugging',
    },
    { value: 'flags', label: 'Feature Flags', hint: 'Feature flag management' },
  ],
  'Platform & Management': [
    {
      value: 'workspace',
      label: 'Workspace',
      hint: 'Organization and project management',
    },
    {
      value: 'docs',
      label: 'Documentation',
      hint: 'PostHog documentation search',
    },
  ],
};

export const ALL_FEATURE_VALUES = Object.values(AVAILABLE_FEATURES)
  .flat()
  .map((feature) => feature.value);

type MCPServerType = 'sse' | 'streamable-http';

export const buildMCPUrl = (
  type: MCPServerType,
  selectedFeatures?: string[],
  local?: boolean,
  region?: CloudRegion,
) => {
  const host = local ? 'http://localhost:8787' : 'https://mcp.posthog.com';
  const baseUrl = `${host}/${type === 'sse' ? 'sse' : 'mcp'}`;

  const isAllFeaturesSelected =
    selectedFeatures &&
    selectedFeatures.length === ALL_FEATURE_VALUES.length &&
    ALL_FEATURE_VALUES.every((feature) => selectedFeatures.includes(feature));

  const params: string[] = [];

  // Add features param if not all features selected
  if (
    selectedFeatures &&
    selectedFeatures.length > 0 &&
    !isAllFeaturesSelected
  ) {
    params.push(`features=${selectedFeatures.join(',')}`);
  }

  // Add region param for OAuth authorization server routing (EU users)
  if (region && region !== 'us' && !local) {
    params.push(`region=${region}`);
  }

  return params.length > 0 ? `${baseUrl}?${params.join('&')}` : baseUrl;
};

export const getNativeHTTPServerConfig = (
  apiKey: string,
  type: MCPServerType,
  selectedFeatures?: string[],
  local?: boolean,
  region?: CloudRegion,
) => {
  return {
    url: buildMCPUrl(type, selectedFeatures, local, region),
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  };
};

export const getDefaultServerConfig = (
  apiKey: string,
  type: MCPServerType,
  selectedFeatures?: string[],
  local?: boolean,
  region?: CloudRegion,
) => {
  const urlWithFeatures = buildMCPUrl(type, selectedFeatures, local, region);

  return {
    command: 'npx',
    args: [
      '-y',
      'mcp-remote@latest',
      urlWithFeatures,
      '--header',
      `Authorization:\${POSTHOG_AUTH_HEADER}`,
    ],
    env: {
      POSTHOG_AUTH_HEADER: `Bearer ${apiKey}`,
    },
  };
};
