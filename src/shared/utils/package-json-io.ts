import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PackageJson } from './package-json';

/** File operations used by package-manager tools without loading CLI setup. */
export async function readProjectPackageJson(
  installDir: string,
): Promise<PackageJson> {
  const raw = await readFile(join(installDir, 'package.json'), 'utf8');
  return (JSON.parse(raw) as PackageJson | null) ?? {};
}

export async function writeProjectPackageJson(
  installDir: string,
  value: PackageJson,
): Promise<void> {
  await writeFile(
    join(installDir, 'package.json'),
    JSON.stringify(value, null, 2),
    { encoding: 'utf8', flag: 'w' },
  );
}
