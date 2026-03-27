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
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^POSTHOG_PERSONAL_API_KEY=(.+)$/m);
      if (match) {
        return match[1].trim();
      }
    }
  }
  return undefined;
}
