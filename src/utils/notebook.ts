// Mirror a markdown report into a PostHog notebook (one raw-markdown node).
import axios from 'axios';
import type { Credentials } from '@lib/wizard-session';
import { logToFile } from './debug';

// Create a PostHog notebook from raw markdown; returns its URL, or null if the upload failed.
export async function createNotebook(
  { accessToken, host, projectId }: Credentials,
  title: string,
  markdown: string,
): Promise<string | null> {
  try {
    const res = await axios.post(
      `${host.apiHost}/api/projects/${projectId}/notebooks/`,
      {
        title: title.slice(0, 256),
        // PostHog notebooks hold raw markdown in a single ph-markdown-notebook node.
        content: {
          type: 'doc',
          content: [
            {
              type: 'ph-markdown-notebook',
              attrs: { nodeId: 'markdown-notebook-v2', markdown },
            },
          ],
        },
        text_content: markdown,
      },
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15_000 },
    );
    const shortId = (res.data as { short_id?: unknown })?.short_id;
    if (typeof shortId !== 'string') return null;
    return `${host.appHost}/project/${projectId}/notebooks/${shortId}`;
  } catch (err) {
    logToFile(
      `[notebook] create failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
