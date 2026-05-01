import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Server frameworks that don't have dedicated wizard skills.
 * Package name → display name.
 */
const SERVER_FRAMEWORKS: Record<string, string> = {
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  '@hapi/hapi': 'Hapi',
  '@nestjs/core': 'Nest.js',
  hono: 'Hono',
  micro: 'Micro',
  restify: 'Restify',
};

const CLI_PACKAGES = [
  'commander',
  'yargs',
  'meow',
  'oclif',
  'inquirer',
  'vorpal',
];
const WORKER_PACKAGES = ['bullmq', 'bull', 'bee-queue', 'agenda', 'node-cron'];

function getAllDeps(
  packageJson: Record<string, unknown>,
): Record<string, string> {
  return {
    ...(packageJson.dependencies as Record<string, string> | undefined),
    ...(packageJson.devDependencies as Record<string, string> | undefined),
  };
}

export function detectServerFramework(
  packageJson: Record<string, unknown>,
): string | undefined {
  const deps = getAllDeps(packageJson);
  for (const [pkg, name] of Object.entries(SERVER_FRAMEWORKS)) {
    if (deps[pkg]) return name;
  }
  return undefined;
}

export function detectProjectType(
  packageJson: Record<string, unknown>,
): string | undefined {
  const deps = getAllDeps(packageJson);
  if (CLI_PACKAGES.some((pkg) => deps[pkg])) return 'CLI tool';
  if (WORKER_PACKAGES.some((pkg) => deps[pkg]))
    return 'background worker / job processor';
  if (Object.keys(SERVER_FRAMEWORKS).some((pkg) => deps[pkg]))
    return 'API server';
  return undefined;
}

export function detectEntryPoint(
  installDir: string,
  packageJson: Record<string, unknown>,
): string | undefined {
  if (typeof packageJson.main === 'string') return packageJson.main;

  const candidates = [
    'src/index.ts',
    'src/index.js',
    'src/server.ts',
    'src/server.js',
    'src/app.ts',
    'src/app.js',
    'server.ts',
    'server.js',
    'index.ts',
    'index.js',
    'app.ts',
    'app.js',
    'main.ts',
    'main.js',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(installDir, candidate))) return candidate;
  }
  return undefined;
}
