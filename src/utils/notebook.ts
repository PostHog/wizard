/**
 * Mirror a markdown report into a PostHog notebook.
 *
 * PostHog notebooks store raw markdown in a single `ph-markdown-notebook` node,
 * so we hand the report markdown straight to the API — no ProseMirror
 * conversion. The local .md stays the source of truth.
 */
import axios from 'axios';
import { WIZARD_USER_AGENT } from '@lib/constants';
import type { Credentials } from '@lib/wizard-session';
import { logToFile } from './debug';

const API_VERSION = '0.1d';

// A notebook document whose whole body is one raw-markdown node.
export function buildMarkdownNotebookContent(markdown: string): unknown {
  return {
    type: 'doc',
    content: [
      {
        type: 'ph-markdown-notebook',
        attrs: { nodeId: 'markdown-notebook-v2', markdown },
      },
    ],
  };
}

/**
 * Create a PostHog notebook from markdown and return its in-app URL, or null if
 * the upload failed — the caller then shows no link and the local report stands.
 */
export async function createNotebook(
  credentials: Credentials,
  title: string,
  markdown: string,
): Promise<string | null> {
  try {
    const { accessToken, host, projectId } = credentials;
    const res = await axios.post(
      `${host.apiHost}/api/projects/${projectId}/notebooks/`,
      {
        title: title.slice(0, 256),
        content: buildMarkdownNotebookContent(markdown),
        text_content: markdown,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'API-Version': API_VERSION,
          'User-Agent': WIZARD_USER_AGENT,
        },
        timeout: 15_000,
      },
    );

    const data = res.data as { short_id?: unknown } | undefined;
    const shortId = data?.short_id;
    if (typeof shortId !== 'string') return null;
    const url = `${host.appHost}/project/${projectId}/notebooks/${shortId}`;
    logToFile(`[notebook] created: ${url}`);
    return url;
  } catch (err) {
    logToFile(
      `[notebook] create failed, skipping: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
