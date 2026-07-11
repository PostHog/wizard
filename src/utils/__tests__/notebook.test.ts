import { describe, it, expect } from 'vitest';
import { markdownToNotebookDoc, inlineNodes } from '../notebook';

describe('inlineNodes', () => {
  it('splits bold, italic, inline code and links into marked text nodes', () => {
    expect(inlineNodes('a **b** _c_ `d` [e](https://x.y)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'c', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'd', marks: [{ type: 'code' }] },
      { type: 'text', text: ' ' },
      {
        type: 'text',
        text: 'e',
        marks: [{ type: 'link', attrs: { href: 'https://x.y' } }],
      },
    ]);
  });

  it('returns plain text unchanged', () => {
    expect(inlineNodes('just words')).toEqual([
      { type: 'text', text: 'just words' },
    ]);
  });
});

describe('markdownToNotebookDoc', () => {
  it('wraps everything in a doc node', () => {
    const doc = markdownToNotebookDoc('hello');
    expect(doc.type).toBe('doc');
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('maps ATX headings to heading nodes with their level', () => {
    const doc = markdownToNotebookDoc('# One\n\n### Three');
    expect(doc.content).toEqual([
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'One' }],
      },
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Three' }],
      },
    ]);
  });

  it('maps bullet and ordered lists to the tiptap list nodes', () => {
    const bullet = markdownToNotebookDoc('- a\n- b');
    expect(bullet.content[0]).toEqual({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
      ],
    });
    const ordered = markdownToNotebookDoc('1. a\n2. b');
    expect(ordered.content[0].type).toBe('orderedList');
    expect(ordered.content[0].content).toHaveLength(2);
  });

  it('parses a pipe table into header + cell rows', () => {
    const doc = markdownToNotebookDoc(
      ['| Event | File |', '| --- | --- |', '| `signup` | app.ts |'].join('\n'),
    );
    const table = doc.content[0];
    expect(table.type).toBe('table');
    expect(table.content?.[0]).toEqual({
      type: 'tableRow',
      content: [
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Event' }] }] },
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'File' }] }] },
      ],
    });
    // Body cell keeps inline marks (the backticked event name).
    expect(table.content?.[1]?.content?.[0]).toEqual({
      type: 'tableCell',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'signup', marks: [{ type: 'code' }] }],
        },
      ],
    });
  });

  it('handles blockquotes, fenced code and horizontal rules', () => {
    const doc = markdownToNotebookDoc('> quoted\n\n```ts\nconst x = 1;\n```\n\n---');
    expect(doc.content[0].type).toBe('blockquote');
    expect(doc.content[1]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    });
    expect(doc.content[2]).toEqual({ type: 'horizontalRule' });
  });

  it('joins consecutive plain lines into one paragraph', () => {
    const doc = markdownToNotebookDoc('line one\nline two\n\nnext para');
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'line one line two' }],
    });
  });
});
