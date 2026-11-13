import fs from 'fs';

export interface CastWriter {
  appendOutput: (chunk: string) => void;
  close: () => void;
}

export function openCastWriter(
  castPath: string,
  terminalSize: { cols: number; rows: number },
): CastWriter {
  const castFile = fs.openSync(castPath, 'w');
  fs.writeSync(
    castFile,
    JSON.stringify({
      version: 2,
      width: terminalSize.cols,
      height: terminalSize.rows,
      timestamp: Math.floor(Date.now() / 1000),
      env: { TERM: 'xterm-256color' },
    }) + '\n',
  );
  const recordingStartedAt = performance.now();
  let isClosed = false;
  const appendOutput = (chunk: string) => {
    if (isClosed) return;
    const elapsedSeconds = (performance.now() - recordingStartedAt) / 1000;
    fs.writeSync(
      castFile,
      JSON.stringify([Number(elapsedSeconds.toFixed(6)), 'o', chunk]) + '\n',
    );
  };
  return {
    appendOutput,
    close() {
      if (isClosed) return;
      appendOutput('');
      isClosed = true;
      fs.closeSync(castFile);
    },
  };
}
