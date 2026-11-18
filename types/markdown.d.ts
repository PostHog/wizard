// A `.md` import is the file's text (tsdown's loader, the Vitest plugin, `pnpm try`'s hook).
declare module '*.md' {
  const text: string;
  export default text;
}
