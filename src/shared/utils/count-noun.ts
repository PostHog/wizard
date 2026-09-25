/** `1 error`, `2 errors`, `0 errors`. Zero stays plural. */
export function countNoun(
  n: number,
  noun: string,
  plural = `${noun}s`,
): string {
  return `${n} ${n === 1 ? noun : plural}`;
}
