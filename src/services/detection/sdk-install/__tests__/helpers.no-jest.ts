import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** A throwaway project directory holding `files` (relative paths), removed after `fn`. */
export async function withProject<T>(
  files: Record<string, string>,
  fn: (dir: string) => Promise<T> | T,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-install-'));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(dir, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
