import z from 'zod';

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
      hint: 'Analytics insights',
    },
    {
      value: 'product_analytics',
      label: 'Product Analytics',
      hint: 'Insight CRUD management',
    },
    {
      value: 'experiments',
      label: 'Experiments',
      hint: 'A/B testing experiments',
    },
    {
      value: 'surveys',
      label: 'Surveys',
      hint: 'Survey management',
    },
    {
      value: 'annotations',
      label: 'Annotations',
      hint: 'Annotation management',
    },
    {
      value: 'replay',
      label: 'Session Replay',
      hint: 'Session recording management',
    },
    {
      value: 'sql',
      label: 'SQL',
      hint: 'SQL query execution',
    },
  ],
  'AI Engineering': [
    {
      value: 'llm_analytics',
      label: 'LLM Analytics',
      hint: 'LLM usage and cost tracking',
    },
    {
      value: 'prompts',
      label: 'Prompts',
      hint: 'LLM prompt management',
    },
  ],
  'Development Tools': [
    {
      value: 'error_tracking',
      label: 'Error Tracking',
      hint: 'Error monitoring and debugging',
    },
    {
      value: 'logs',
      label: 'Logs',
      hint: 'Log querying',
    },
    {
      value: 'flags',
      label: 'Feature Flags',
      hint: 'Feature flag management',
    },
    {
      value: 'early_access_features',
      label: 'Early Access Features',
      hint: 'Early access feature management',
    },
    {
      value: 'cohorts',
      label: 'Cohorts',
      hint: 'Cohort management',
    },
  ],
  'Data Management': [
    {
      value: 'events',
      label: 'Events',
      hint: 'Event and property definitions',
    },
    {
      value: 'persons',
      label: 'Persons',
      hint: 'Person and group management',
    },
    {
      value: 'actions',
      label: 'Actions',
      hint: 'Action definitions',
    },
    {
      value: 'data_warehouse',
      label: 'Data Warehouse',
      hint: 'Data warehouse management',
    },
    {
      value: 'endpoints',
      label: 'Endpoints',
      hint: 'Data warehouse endpoint management',
    },
    {
      value: 'data_schema',
      label: 'Data Schema',
      hint: 'Data schema exploration',
    },
  ],
  'CDP & Automation': [
    {
      value: 'hog_functions',
      label: 'Hog Functions',
      hint: 'CDP function management',
    },
    {
      value: 'hog_function_templates',
      label: 'Hog Function Templates',
      hint: 'CDP function template browsing',
    },
    {
      value: 'workflows',
      label: 'Workflows',
      hint: 'Workflow management',
    },
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
    {
      value: 'notebooks',
      label: 'Notebooks',
      hint: 'Notebook management',
    },
    {
      value: 'alerts',
      label: 'Alerts',
      hint: 'Alert management',
    },
    {
      value: 'platform_features',
      label: 'Platform Features',
      hint: 'Activity logs, approvals, comments, and roles',
    },
    {
      value: 'integrations',
      label: 'Integrations',
      hint: 'Connected integration management',
    },
    {
      value: 'conversations',
      label: 'Conversations',
      hint: 'Support ticket management',
    },
    {
      value: 'core',
      label: 'Subscriptions',
      hint: 'Scheduled insight and dashboard deliveries',
    },
    {
      value: 'search',
      label: 'Search',
      hint: 'Entity search across the project',
    },
    {
      value: 'reverse_proxy',
      label: 'Reverse Proxy',
      hint: 'Reverse proxy record management',
    },
    {
      value: 'debug',
      label: 'Debug',
      hint: 'Debug and diagnostic tools',
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

  return params.length > 0 ? `${baseUrl}?${params.join('&')}` : baseUrl;
};

export const getNativeHTTPServerConfig = (
  apiKey: string | undefined,
  type: MCPServerType,
  selectedFeatures?: string[],
  local?: boolean,
) => {
  const config: Record<string, unknown> = {
    url: buildMCPUrl(type, selectedFeatures, local),
  };

  // Only add auth header if API key is provided (not OAuth mode)
  if (apiKey) {
    config.headers = {
      Authorization: `Bearer ${apiKey}`,
    };
  }

  return config;
};

export const getDefaultServerConfig = (
  apiKey: string | undefined,
  type: MCPServerType,
  selectedFeatures?: string[],
  local?: boolean,
) => {
  const urlWithFeatures = buildMCPUrl(type, selectedFeatures, local);

  // OAuth mode: no auth header, let MCP handle OAuth
  if (!apiKey) {
    return {
      command: 'npx',
      args: ['-y', 'mcp-remote@latest', urlWithFeatures],
    };
  }

  // API key mode: include auth header
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
