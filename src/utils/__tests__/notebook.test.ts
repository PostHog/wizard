import { describe, it, expect } from 'vitest';
import { buildMarkdownNotebookContent } from '../notebook';

describe('buildMarkdownNotebookContent', () => {
  it('wraps the raw markdown in a single ph-markdown-notebook node', () => {
    const md = '# Report\n\n- [ ] todo\n- [x] done';
    expect(buildMarkdownNotebookContent(md)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'ph-markdown-notebook',
          attrs: { nodeId: 'markdown-notebook-v2', markdown: md },
        },
      ],
    });
  });

  it('passes markdown through verbatim — PostHog renders it, we never convert', () => {
    const md = '## Verify\n\n- [ ] build & typecheck\n\n[dashboard](https://us.posthog.com/x)';
    const doc = buildMarkdownNotebookContent(md) as {
      content: { attrs: { markdown: string } }[];
    };
    expect(doc.content[0].attrs.markdown).toBe(md);
  });
});
