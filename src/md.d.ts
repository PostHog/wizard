/** Markdown files import as their text content (bundled at build time). */
declare module '*.md' {
  const content: string;
  export default content;
}
