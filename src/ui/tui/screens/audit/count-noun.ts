/** `1 error`, `2 errors`, `0 errors`. Zero stays plural. */
export const countNoun = (n: number, noun: string, plural = `${noun}s`) =>
  `${n} ${n === 1 ? noun : plural}`;
