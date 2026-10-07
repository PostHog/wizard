import * as path from 'path';
import { readProjectFile } from './bounded-fs';

/**
 * Read POSTHOG_PERSONAL_API_KEY from .env.local or .env in the current
 * working directory. Returns undefined when no key is found.
 */
export function readApiKeyFromEnv(): string | undefined {
  for (const envFile of ['.env.local', '.env']) {
    // null when missing or unreadable, e.g. a `.env` directory (a Python virtualenv).
    const content = readProjectFile(path.join(process.cwd(), envFile));
    const match = content?.match(/^POSTHOG_PERSONAL_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  }
  return undefined;
}
