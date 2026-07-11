/**
 * Mirror a markdown report into a PostHog notebook.
 *
 * The local markdown file stays the source of truth; the notebook is a
 * shareable, in-PostHog copy the user can link to and comment on. Notebooks
 * store a tiptap/ProseMirror document, so we convert the markdown to that
 * shape here rather than making the agent hand-author notebook nodes.
 *
 * The converter covers the subset the setup report uses — headings,
 * paragraphs, bullet/ordered lists, blockquotes, fenced code, horizontal
 * rules, pipe tables, and inline bold/italic/code/link marks. Anything it
 * doesn't recognise degrades to a plain paragraph; since the .md file is
 * authoritative, an imperfect mirror is harmless.
 */
import axios from 'axios';
import { WIZARD_USER_AGENT } from '@lib/constants';
import type { Credentials } from '@lib/wizard-session';
import { logToFile } from './debug';

// Loosely-typed notebook nodes — shapes vary per node and the server validates.
type Mark = { type: string; attrs?: Record<string, unknown> };
type TextNode = { type: 'text'; text: string; marks?: Mark[] };
export type NotebookNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<NotebookNode | TextNode>;
};
export type NotebookDoc = { type: 'doc'; content: NotebookNode[] };

const API_VERSION = '0.1d';

// ---------------------------------------------------------------------------
// Inline marks
// ---------------------------------------------------------------------------

// One regex, alternation ordered so links/code win before emphasis.
const INLINE = new RegExp(
  [
    /\[([^\]]+)\]\(([^)]+)\)/.source, // 1=text 2=href  → link
    /`([^`]+)`/.source, //              3=code          → inline code
    /\*\*([^*]+)\*\*/.source, //        4=bold
    /__([^_]+)__/.source, //            5=bold
    /\*([^*]+)\*/.source, //            6=italic
    /_([^_]+)_/.source, //              7=italic
  ].join('|'),
);

function text(value: string, marks?: Mark[]): TextNode {
  return marks && marks.length
    ? { type: 'text', text: value, marks }
    : { type: 'text', text: value };
}

/** Parse a single line of markdown into text nodes carrying inline marks. */
export function inlineNodes(input: string): TextNode[] {
  const nodes: TextNode[] = [];
  let rest = input;
  while (rest.length) {
    const m = INLINE.exec(rest);
    if (!m) {
      nodes.push(text(rest));
      break;
    }
    if (m.index > 0) nodes.push(text(rest.slice(0, m.index)));
    if (m[1] !== undefined) {
      nodes.push(text(m[1], [{ type: 'link', attrs: { href: m[2] } }]));
    } else if (m[3] !== undefined) {
      nodes.push(text(m[3], [{ type: 'code' }]));
    } else if (m[4] !== undefined || m[5] !== undefined) {
      nodes.push(text(m[4] ?? m[5], [{ type: 'bold' }]));
    } else {
      nodes.push(text(m[6] ?? m[7], [{ type: 'italic' }]));
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return nodes;
}

function paragraph(line: string): NotebookNode {
  const content = inlineNodes(line);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^ {0,3}([-*_])( *\1){2,} *$/;
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+\.\s+(.*)$/;
const TABLE_SEP = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

function cell(kind: 'tableHeader' | 'tableCell', value: string): NotebookNode {
  return { type: kind, content: [paragraph(value)] };
}

/** Convert a markdown string into a PostHog notebook document. */
export function markdownToNotebookDoc(markdown: string): NotebookDoc {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const content: NotebookNode[] = [];
  let i = 0;

  const listItems = (match: RegExp): NotebookNode[] => {
    const items: NotebookNode[] = [];
    while (i < lines.length) {
      // Task lines also match the bullet pattern, but form their own taskList.
      if (TASK.test(lines[i])) break;
      const m = lines[i].match(match);
      if (!m) break;
      items.push({ type: 'listItem', content: [paragraph(m[1])] });
      i++;
    }
    return items;
  };

  const taskItems = (): NotebookNode[] => {
    const items: NotebookNode[] = [];
    while (i < lines.length) {
      const m = lines[i].match(TASK);
      if (!m) break;
      items.push({
        type: 'taskItem',
        attrs: { checked: m[1].toLowerCase() === 'x' },
        content: [paragraph(m[2])],
      });
      i++;
    }
    return items;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      content.push({
        type: 'codeBlock',
        attrs: { language: fence[1] || null },
        content: code.length ? [text(code.join('\n'))] : undefined,
      });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      content.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: inlineNodes(heading[2]),
      });
      i++;
      continue;
    }

    if (HR.test(line)) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Pipe table: a header row followed by a |---| separator row.
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      TABLE_SEP.test(lines[i + 1])
    ) {
      const header = splitRow(line);
      i += 2; // header + separator
      const rows: NotebookNode[] = [
        {
          type: 'tableRow',
          content: header.map((c) => cell('tableHeader', c)),
        },
      ];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push({
          type: 'tableRow',
          content: splitRow(lines[i]).map((c) => cell('tableCell', c)),
        });
        i++;
      }
      content.push({ type: 'table', content: rows });
      continue;
    }

    if (TASK.test(line)) {
      content.push({ type: 'taskList', content: taskItems() });
      continue;
    }

    if (UL.test(line)) {
      content.push({ type: 'bulletList', content: listItems(UL) });
      continue;
    }

    if (OL.test(line)) {
      content.push({ type: 'orderedList', content: listItems(OL) });
      continue;
    }

    if (line.trimStart().startsWith('>')) {
      const quoted: NotebookNode[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        quoted.push(paragraph(lines[i].replace(/^\s*>\s?/, '')));
        i++;
      }
      content.push({ type: 'blockquote', content: quoted });
      continue;
    }

    // Paragraph: gather consecutive plain lines into one block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      const l = lines[i];
      if (
        HEADING.test(l) ||
        HR.test(l) ||
        UL.test(l) ||
        OL.test(l) ||
        l.trimStart().startsWith('>') ||
        /^\s*```/.test(l)
      ) {
        break;
      }
      para.push(l.trim());
      i++;
    }
    content.push(paragraph(para.join(' ')));
  }

  return { type: 'doc', content };
}

/** Strip markdown syntax to a plain-text summary for notebook search. */
function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|~-]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

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
        content: markdownToNotebookDoc(markdown),
        text_content: plainText(markdown),
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
