import * as fs from 'fs';
import * as path from 'path';

/**
 * Read POSTHOG_PERSONAL_API_KEY from .env.local or .env in the current
 * working directory. Returns undefined when no key is found.
 */
export function readApiKeyFromEnv(): string | undefined {
  const envFiles = ['.env.local', '.env'];
  for (const envFile of envFiles) {
    const envPath = path.join(process.cwd(), envFile);
    let content: string;
    try {
      // `.env`/`.env.local` is occasionally a directory (e.g. a Python
      // virtualenv named `.env`), so read directly and skip on failure rather
      // than guarding with existsSync, which returns true for directories and
      // lets readFileSync throw EISDIR.
      content = fs.readFileSync(envPath, 'utf8');
    } catch {
      continue;
    }
    const match = content.match(/^POSTHOG_PERSONAL_API_KEY=(.+)$/m);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}
