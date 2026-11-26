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

import { existsSync, readdirSync, statSync } from 'fs';
import { extname, join } from 'path';
import { readProjectFile } from '@utils/bounded-fs';
import { parsePackageJson } from '@utils/package-json';

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
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.posthog-wizard-cache',
]);
const MAX_SCAN_FILES = 40;

function normalizePyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}

function parsePyDeps(installDir: string): Map<string, string> {
  const deps = new Map<string, string>();
  const addLine = (raw: string) => {
    const clean = raw.split('#')[0]?.trim() ?? '';
    if (!clean || clean.startsWith('-')) return;
    const m = /^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*(.*)$/.exec(clean);
    if (m) deps.set(normalizePyName(m[1]), m[2].trim());
  };

  const req = readProjectFile(join(installDir, 'requirements.txt'));
  if (req) {
    for (const line of req.split('\n')) addLine(line);
  }

  const pyproject = readProjectFile(join(installDir, 'pyproject.toml'));
  if (pyproject) {
    const depMatches = pyproject.matchAll(
      /["']([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?([^"']*)["']/g,
    );
    for (const m of depMatches) {
      const norm = normalizePyName(m[1]);
      if (!deps.has(norm)) deps.set(norm, (m[2] ?? '').trim());
    }
  }

  return deps;
}

function isPreOneOpenAi(spec: string | undefined): boolean {
  if (!spec) return false;
  const m = /(\d+)\.\d+/.exec(spec);
  return m !== null && Number(m[1]) === 0;
}

function hasGatewayOverrideInSource(installDir: string): boolean {
  let scanned = 0;
  const stack = [installDir];
  while (stack.length > 0 && scanned < MAX_SCAN_FILES) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (scanned >= MAX_SCAN_FILES) break;
      if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && CODE_EXTS.has(extname(entry))) {
        scanned += 1;
        const content = readProjectFile(full);
        if (content && GATEWAY_OVERRIDE_RE.test(content)) return true;
      }
    }
  }
  return false;
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

  if (hasNode) {
    if (nodeFrameworks.length > 1) return undefined;
    if (nodeFrameworks.length === 1) {
      // Framework wins over underlying provider unless another provider suggests side-path usage.
      return nodeFrameworks[0];
    }
    if (nodeProviders.length !== 1) return undefined;
    const only = nodeProviders[0];
    if (only === 'ai-observability-openai-node') {
      if (
        isPreOneOpenAi(nodeDeps.get('openai')) ||
        hasGatewayOverrideInSource(installDir)
      ) {
        return undefined;
      }
    }
    return only;
  }

  if (pyFrameworks.length > 1) return undefined;
  if (pyFrameworks.length === 1) return pyFrameworks[0];
  if (pyProviders.length !== 1) return undefined;
  const onlyPy = pyProviders[0];
  if (onlyPy === 'ai-observability-openai-python') {
    if (
      isPreOneOpenAi(pyDeps.get('openai')) ||
      hasGatewayOverrideInSource(installDir)
    ) {
      return undefined;
    }
  }
  return onlyPy;
}
