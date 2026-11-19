// The load hook markdown-loader.no-jest.mjs registers: a `.md` module exports the file's text.
import { readFile } from 'node:fs/promises';

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !new URL(url).pathname.endsWith('.md')) {
    return nextLoad(url, context);
  }
  const text = await readFile(new URL(url), 'utf8');
  return {
    format: 'module',
    source: `export default ${JSON.stringify(text)};`,
    shortCircuit: true,
  };
}
