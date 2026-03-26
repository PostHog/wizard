import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Integration } from './constants';
import { computeProjectFingerprint } from './project-fingerprint';
import { logToFile } from '../utils/debug';

const CACHE_VERSION = 2;
const MAX_CACHE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface CachedAgentTodo {
  content: string;
  status: string;
  activeForm?: string;
}

export interface CachedPlannedEvent {
  name: string;
  description: string;
}

export type CachedRunStage = 'discovery' | 'execution';

export interface AgentSessionCacheEntry {
  version: number;
  installDir: string;
  integration: Integration;
  projectFingerprint: string;
  scopeKey: string;
  sessionId: string;
  runStage: CachedRunStage;
  todos: CachedAgentTodo[];
  eventPlan?: CachedPlannedEvent[];
  updatedAt: string;
}

interface LoadAgentSessionCacheOptions {
  allowScopeMismatch?: boolean;
}

function getCacheDir(): string {
  return (
    process.env.POSTHOG_WIZARD_CACHE_DIR ??
    path.join(os.homedir(), '.posthog-wizard', 'agent-sessions')
  );
}

function normalizeInstallDir(installDir: string): string {
  return path.resolve(installDir);
}

function getCacheFilePath(
  installDir: string,
  integration: Integration,
): string {
  const key = createHash('sha256')
    .update(`${normalizeInstallDir(installDir)}::${integration}`)
    .digest('hex');

  return path.join(getCacheDir(), `${key}.json`);
}

function isValidTodo(value: unknown): value is CachedAgentTodo {
  if (!value || typeof value !== 'object') return false;

  const todo = value as Record<string, unknown>;
  return (
    typeof todo.content === 'string' &&
    typeof todo.status === 'string' &&
    (todo.activeForm === undefined || typeof todo.activeForm === 'string')
  );
}

function isValidPlannedEvent(value: unknown): value is CachedPlannedEvent {
  if (!value || typeof value !== 'object') return false;

  const event = value as Record<string, unknown>;
  return (
    typeof event.name === 'string' && typeof event.description === 'string'
  );
}

function isReusableCacheEntry(
  value: unknown,
  installDir: string,
  integration: Integration,
  projectFingerprint: string,
): value is AgentSessionCacheEntry {
  if (!value || typeof value !== 'object') return false;

  const entry = value as Record<string, unknown>;
  return (
    entry.version === CACHE_VERSION &&
    entry.installDir === normalizeInstallDir(installDir) &&
    entry.integration === integration &&
    entry.projectFingerprint === projectFingerprint &&
    typeof entry.scopeKey === 'string' &&
    typeof entry.sessionId === 'string' &&
    (entry.runStage === 'discovery' || entry.runStage === 'execution') &&
    typeof entry.updatedAt === 'string' &&
    Array.isArray(entry.todos) &&
    entry.todos.every(isValidTodo) &&
    (entry.eventPlan === undefined ||
      (Array.isArray(entry.eventPlan) &&
        entry.eventPlan.every(isValidPlannedEvent)))
  );
}

export function loadAgentSessionCache(
  installDir: string,
  integration: Integration,
  scopeKey: string,
  options?: LoadAgentSessionCacheOptions,
): AgentSessionCacheEntry | null {
  const cachePath = getCacheFilePath(installDir, integration);
  const projectFingerprint = computeProjectFingerprint(installDir);

  try {
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    if (
      !isReusableCacheEntry(parsed, installDir, integration, projectFingerprint)
    ) {
      logToFile('Agent session cache miss: fingerprint or metadata mismatch', {
        installDir: normalizeInstallDir(installDir),
        integration,
        cachePath,
      });
      return null;
    }

    if (parsed.scopeKey !== scopeKey && !options?.allowScopeMismatch) {
      logToFile('Agent session cache miss: scope mismatch', {
        installDir: normalizeInstallDir(installDir),
        integration,
        cachePath,
        cachedScopeKey: parsed.scopeKey,
        requestedScopeKey: scopeKey,
      });
      return null;
    }

    const updatedAtMs = Date.parse(parsed.updatedAt);
    if (
      !Number.isFinite(updatedAtMs) ||
      Date.now() - updatedAtMs > MAX_CACHE_AGE_MS
    ) {
      logToFile('Agent session cache expired', {
        installDir: normalizeInstallDir(installDir),
        integration,
        cachePath,
      });
      clearAgentSessionCache(installDir, integration);
      return null;
    }

    logToFile('Agent session cache hit', {
      installDir: normalizeInstallDir(installDir),
      integration,
      cachePath,
      sessionId: parsed.sessionId,
      scopeMatch: parsed.scopeKey === scopeKey,
    });
    return parsed;
  } catch {
    return null;
  }
}

export function saveAgentSessionCache(
  installDir: string,
  integration: Integration,
  scopeKey: string,
  sessionId: string,
  runStage: CachedRunStage,
  todos: CachedAgentTodo[],
  eventPlan: CachedPlannedEvent[] = [],
): void {
  const cachePath = getCacheFilePath(installDir, integration);

  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify(
        {
          version: CACHE_VERSION,
          installDir: normalizeInstallDir(installDir),
          integration,
          projectFingerprint: computeProjectFingerprint(installDir),
          scopeKey,
          sessionId,
          runStage,
          todos,
          eventPlan,
          updatedAt: new Date().toISOString(),
        } satisfies AgentSessionCacheEntry,
        null,
        2,
      ),
      'utf-8',
    );
  } catch (error) {
    logToFile('Failed to save agent session cache:', error);
  }
}

export function clearAgentSessionCache(
  installDir: string,
  integration: Integration,
): void {
  const cachePath = getCacheFilePath(installDir, integration);

  try {
    fs.unlinkSync(cachePath);
  } catch {
    // Ignore missing cache files.
  }
}
