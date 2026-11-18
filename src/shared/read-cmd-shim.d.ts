declare module 'read-cmd-shim' {
  const readCmdShim: { sync(path: string): string };
  export default readCmdShim;
}
