/**
 * Conservative pre-install resolver for `wizard ai-observability`.
 *
 * Returns a context-mill `ai-observability-*` skill id ONLY when the project's
 * root manifest names a single unambiguous framework or provider matching the
 * ordered rules in `1-begin.md`, with no monorepo workspace, no Go/mixed-runtime
 * ambiguity, no pre-1.0 `openai` pin, and no gateway `baseURL` override.
 *
 * Returns `undefined` for every ambiguous or custom case so the agent falls back
 * to `load_skill_menu` + `install_skill` at runtime.
 */

import { existsSync } from 'fs';
import { extname, join } from 'path';
import { readProjectFile, walkProjectFiles } from '@utils/bounded-fs';
import { parsePackageJson } from '@utils/package-json';
import {
  parsePyprojectToml,
  parseRequirementsTxt,
} from '@services/project-discovery';

const NODE_FRAMEWORK_SKILLS: ReadonlyArray<readonly [string, string]> = [
  ['@openai/agents', 'ai-observability-openai-agents'],
  ['@anthropic-ai/claude-agent-sdk', 'ai-observability-claude-agent-sdk'],
  ['@langchain/langgraph', 'ai-observability-langgraph-node'],
  ['@langchain/core', 'ai-observability-langchain-node'],
  ['langchain', 'ai-observability-langchain-node'],
  ['ai', 'ai-observability-vercel-ai'],
  ['llamaindex', 'ai-observability-llamaindex'],
  ['@mastra/core', 'ai-observability-mastra'],
  ['@google/adk', 'ai-observability-google-adk'],
  ['@instructor-ai/instructor', 'ai-observability-instructor-node'],
  ['convex', 'ai-observability-convex'],
];

const NODE_PROVIDER_SKILLS: ReadonlyArray<readonly [string, string]> = [
  ['openai', 'ai-observability-openai-node'],
  ['@anthropic-ai/sdk', 'ai-observability-anthropic-node'],
  ['@google/genai', 'ai-observability-google-node'],
  ['@google/generative-ai', 'ai-observability-google-node'],
  ['@mistralai/mistralai', 'ai-observability-mistral-node'],
  ['cohere-ai', 'ai-observability-cohere-node'],
  ['portkey-ai', 'ai-observability-portkey-node'],
];

const PYTHON_FRAMEWORK_SKILLS: ReadonlyArray<readonly [string, string]> = [
  ['openai-agents', 'ai-observability-openai-agents'],
  ['claude-agent-sdk', 'ai-observability-claude-agent-sdk'],
  ['langgraph', 'ai-observability-langgraph-python'],
  ['langchain', 'ai-observability-langchain-python'],
  ['langchain-core', 'ai-observability-langchain-python'],
  ['llama-index', 'ai-observability-llamaindex'],
  ['crewai', 'ai-observability-crewai'],
  ['pyautogen', 'ai-observability-autogen'],
  ['autogen-agentchat', 'ai-observability-autogen'],
  ['dspy', 'ai-observability-dspy'],
  ['dspy-ai', 'ai-observability-dspy'],
  ['pydantic-ai', 'ai-observability-pydantic-ai'],
  ['semantic-kernel', 'ai-observability-semantic-kernel'],
  ['smolagents', 'ai-observability-smolagents'],
  ['mirascope', 'ai-observability-mirascope'],
  ['instructor', 'ai-observability-instructor-python'],
  ['litellm', 'ai-observability-litellm'],
];

const PYTHON_PROVIDER_SKILLS: ReadonlyArray<readonly [string, string]> = [
  ['openai', 'ai-observability-openai-python'],
  ['anthropic', 'ai-observability-anthropic-python'],
  ['google-genai', 'ai-observability-google-python'],
  ['google-generativeai', 'ai-observability-google-python'],
  ['mistralai', 'ai-observability-mistral-python'],
  ['cohere', 'ai-observability-cohere-python'],
  ['portkey-ai', 'ai-observability-portkey-python'],
];

const GATEWAY_OVERRIDE_RE =
  /\b(OPENAI_BASE_URL|baseURL|base_url)\b|api\.groq\.com|openrouter\.ai|api\.together\.xyz|localhost:11434/;
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py']);
export const MAX_GATEWAY_SCAN_FILES = 200;
const GATEWAY_SCAN_DEPTH = 5;

function parsePyDeps(installDir: string): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  const record = (parsed: Record<string, string>) => {
    for (const [name, spec] of Object.entries(parsed)) {
      const existing = deps.get(name);
      if (existing) {
        existing.push(spec);
      } else {
        deps.set(name, [spec]);
      }
    }
  };

  const req = readProjectFile(join(installDir, 'requirements.txt'));
  if (req) record(parseRequirementsTxt(req));

  const pyproject = readProjectFile(join(installDir, 'pyproject.toml'));
  if (pyproject) record(parsePyprojectToml(pyproject));

  return deps;
}

function isPreOneOpenAi(spec: string | undefined): boolean {
  if (!spec) return false;
  const m = /(\d+)\.\d+/.exec(spec);
  return m !== null && Number(m[1]) === 0;
}

/**
 * Returns true if any scanned source file configures a custom gateway/baseURL
 * override OR if the project exceeds the bounded scan cap (conservative fallback).
 */
function mayHaveGatewayOverride(
  installDir: string,
  maxScanFiles = MAX_GATEWAY_SCAN_FILES,
): boolean {
  let scanned = 0;
  let found = false;
  let capped = false;

  const complete = walkProjectFiles(
    installDir,
    (name, fullPath) => {
      if (found || capped) return;
      if (!CODE_EXTS.has(extname(name))) return;
      scanned += 1;
      if (scanned > maxScanFiles) {
        capped = true;
        return;
      }
      const content = readProjectFile(fullPath);
      if (content && GATEWAY_OVERRIDE_RE.test(content)) {
        found = true;
      }
    },
    GATEWAY_SCAN_DEPTH,
    { followSymlinks: false },
  );

  return found || capped || !complete;
}

function uniqueMatches(
  depNames: ReadonlySet<string>,
  table: ReadonlyArray<readonly [string, string]>,
): string[] {
  const hits = new Set<string>();
  for (const [pkg, skillId] of table) {
    if (depNames.has(pkg)) hits.add(skillId);
  }
  return [...hits];
}

/**
 * Resolve an unambiguous `ai-observability-*` skill id for `installDir`, or
 * `undefined` when runtime menu discovery is safer.
 */
export function detectUnambiguousAioSkill(
  installDir: string,
  opts?: { maxScanFiles?: number },
): string | undefined {
  // Go projects or workspaces can house LLM calls in sub-packages or require Go >= 1.25 checks.
  if (
    existsSync(join(installDir, 'go.mod')) ||
    existsSync(join(installDir, 'pnpm-workspace.yaml'))
  ) {
    return undefined;
  }

  const pkgText = readProjectFile(join(installDir, 'package.json'));
  const pkg = pkgText ? parsePackageJson(pkgText) : null;
  if (pkg && 'workspaces' in pkg && pkg.workspaces) return undefined;

  const nodeDeps = new Map<string, string>();
  if (pkg) {
    for (const [k, v] of Object.entries({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    })) {
      if (typeof v === 'string') nodeDeps.set(k, v);
    }
  }
  const pyDeps = parsePyDeps(installDir);

  const nodeSet = new Set(nodeDeps.keys());
  const pySet = new Set(pyDeps.keys());

  const nodeFrameworks = uniqueMatches(nodeSet, NODE_FRAMEWORK_SKILLS);
  const nodeProviders = uniqueMatches(nodeSet, NODE_PROVIDER_SKILLS);
  const pyFrameworks = uniqueMatches(pySet, PYTHON_FRAMEWORK_SKILLS);
  const pyProviders = uniqueMatches(pySet, PYTHON_PROVIDER_SKILLS);

  const hasNode = nodeFrameworks.length > 0 || nodeProviders.length > 0;
  const hasPy = pyFrameworks.length > 0 || pyProviders.length > 0;

  // Mixed Node + Python LLM dependencies stay ambiguous.
  if (hasNode && hasPy) return undefined;
  if (!hasNode && !hasPy) return undefined;

  const maxScanFiles = opts?.maxScanFiles ?? MAX_GATEWAY_SCAN_FILES;

  if (hasNode) {
    if (nodeFrameworks.length > 1) return undefined;
    if (nodeFrameworks.length === 1) {
      // Framework wins over one underlying provider, but multiple providers,
      // pre-1.0 OpenAI, or gateway overrides fall back to runtime discovery.
      if (
        nodeProviders.length > 1 ||
        (nodeProviders.includes('ai-observability-openai-node') &&
          isPreOneOpenAi(nodeDeps.get('openai'))) ||
        mayHaveGatewayOverride(installDir, maxScanFiles)
      ) {
        return undefined;
      }
      return nodeFrameworks[0];
    }
    if (nodeProviders.length !== 1) return undefined;
    const only = nodeProviders[0];
    if (
      only === 'ai-observability-openai-node' &&
      (isPreOneOpenAi(nodeDeps.get('openai')) ||
        mayHaveGatewayOverride(installDir, maxScanFiles))
    ) {
      return undefined;
    }
    return only;
  }

  if (pyFrameworks.length > 1) return undefined;
  if (pyFrameworks.length === 1) {
    const pyOpenAiSpecs = pyDeps.get('openai') ?? [];
    if (
      pyProviders.length > 1 ||
      (pyProviders.includes('ai-observability-openai-python') &&
        pyOpenAiSpecs.some((spec) => isPreOneOpenAi(spec))) ||
      mayHaveGatewayOverride(installDir, maxScanFiles)
    ) {
      return undefined;
    }
    return pyFrameworks[0];
  }
  if (pyProviders.length !== 1) return undefined;
  const onlyPy = pyProviders[0];
  if (onlyPy === 'ai-observability-openai-python') {
    const pyOpenAiSpecs = pyDeps.get('openai') ?? [];
    if (
      pyOpenAiSpecs.some((spec) => isPreOneOpenAi(spec)) ||
      mayHaveGatewayOverride(installDir, maxScanFiles)
    ) {
      return undefined;
    }
  }
  return onlyPy;
}
