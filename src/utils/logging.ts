export function prepareMessage(msg: unknown): string {
  if (typeof msg === 'string') {
    return msg;
  }
  if (msg instanceof Error) {
    return `${msg.stack || ''}`;
  }
  return JSON.stringify(msg, null, '\t');
}

export function l(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

export function nl(): void {
  return l('');
}

export function green(msg: string): void {
  return l(prepareMessage(msg));
}

export function red(msg: string): void {
  return l(prepareMessage(msg));
}

export function dim(msg: string): void {
  return l(prepareMessage(msg));
}

export function yellow(msg: string): void {
  return l(prepareMessage(msg));
}

export function cyan(msg: string): void {
  return l(prepareMessage(msg));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debug(msg: any): void {
  return l(prepareMessage(msg));
}
