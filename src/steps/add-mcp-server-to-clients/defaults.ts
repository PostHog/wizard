import z from 'zod';

export const DefaultMCPClientConfig = z.object({
  mcpServers: z.record(
    z.string(),
    z.object({
      command: z.string(),
      args: z.array(z.string()),
      env: z.record(z.string(), z.string()),
    }),
  ),
});

export const getDefaultServerConfig = (apiKey: string) => ({
  command: 'npx',
  args: [
    '-y',
    'mcp-remote@latest',
    'https://mcp.posthog.com/sse',
    '--header',
    `Authorization:\${POSTHOG_AUTH_HEADER}`,
  ],
  env: {
    POSTHOG_AUTH_HEADER: `Bearer ${apiKey}`,
  },
});
