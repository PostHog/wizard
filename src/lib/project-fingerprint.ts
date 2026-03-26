import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';

const FINGERPRINT_IGNORES = [
  '**/.git/**',
  '**/.claude/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/vendor/**',
  '**/Pods/**',
  '**/.env*',
  '**/.posthog-events.json',
];

export function computeProjectFingerprint(installDir: string): string {
  const normalizedInstallDir = path.resolve(installDir);
  const hash = createHash('sha256');

  const files = fg
    .sync(['**/*'], {
      cwd: normalizedInstallDir,
      onlyFiles: true,
      dot: true,
      unique: true,
      ignore: FINGERPRINT_IGNORES,
    })
    .sort();

  for (const relativePath of files) {
    const absolutePath = path.join(normalizedInstallDir, relativePath);

    try {
      const stats = fs.statSync(absolutePath);
      hash.update(relativePath);
      hash.update('\0');
      hash.update(String(stats.size));
      hash.update('\0');
      if (stats.size <= 1024 * 1024) {
        hash.update(fs.readFileSync(absolutePath));
      } else {
        hash.update('large-file');
      }
      hash.update('\0');
    } catch {
      // Ignore files that disappear during fingerprinting.
    }
  }

  return hash.digest('hex');
}
