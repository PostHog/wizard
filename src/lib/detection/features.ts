/**
 * Feature discovery — scan project dependencies for known SDK patterns
 * that indicate additional PostHog workflows are relevant.
 *
 * Pure function: takes an install dir, returns a set of discovered features.
 * No store mutations, no UI calls.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { DiscoveredFeature } from '../wizard-session.js';

const STRIPE_PACKAGES = ['stripe', '@stripe/stripe-js'];

const LLM_PACKAGES = [
  'openai',
  '@anthropic-ai/sdk',
  'ai',
  '@ai-sdk/openai',
  'langchain',
  '@langchain/openai',
  '@langchain/langgraph',
  '@google/generative-ai',
  '@google/genai',
  '@instructor-ai/instructor',
  '@mastra/core',
  'portkey-ai',
];

// PyPI normalizes `_` to `-` and is case-insensitive; compare via normalizePyName.
const PYTHON_LLM_PACKAGES = [
  'openai',
  'anthropic',
  'langchain',
  'langchain-openai',
  'langchain-anthropic',
  'langchain-google-genai',
  'langgraph',
  'litellm',
  'llama-index',
  'pydantic-ai',
  'crewai',
  'instructor',
  'dspy-ai',
  'mistralai',
  'cohere',
  'google-generativeai',
  'google-genai',
  'portkey-ai',
];

export function discoverFeatures(installDir: string): DiscoveredFeature[] {
  const features: DiscoveredFeature[] = [];
  discoverNodeFeatures(installDir, features);
  discoverPythonFeatures(installDir, features);
  return features;
}

function discoverNodeFeatures(
  installDir: string,
  features: DiscoveredFeature[],
): void {
  const text = safeRead(installDir, 'package.json');
  if (!text) return;

  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(text);
  } catch {
    return;
  }

  const depNames = Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  });

  if (depNames.some((d) => STRIPE_PACKAGES.includes(d))) {
    features.push(DiscoveredFeature.Stripe);
  }
  if (depNames.some((d) => LLM_PACKAGES.includes(d))) {
    features.push(DiscoveredFeature.LLM);
  }
}

function discoverPythonFeatures(
  installDir: string,
  features: DiscoveredFeature[],
): void {
  if (features.includes(DiscoveredFeature.LLM)) return;

  const deps: string[] = [];

  const req = safeRead(installDir, 'requirements.txt');
  if (req) deps.push(...parseRequirementsTxt(req));

  const pyproj = safeRead(installDir, 'pyproject.toml');
  if (pyproj) deps.push(...parsePyprojectToml(pyproj));

  const pipfile = safeRead(installDir, 'Pipfile');
  if (pipfile) deps.push(...parsePipfile(pipfile));

  if (deps.some((d) => PYTHON_LLM_PACKAGES.includes(d))) {
    features.push(DiscoveredFeature.LLM);
  }
}

function safeRead(installDir: string, file: string): string | null {
  try {
    return readFileSync(join(installDir, file), 'utf-8');
  } catch {
    return null;
  }
}

function normalizePyName(name: string): string {
  return name.toLowerCase().replace(/_/g, '-');
}

export function parseRequirementsTxt(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
    .map((l) => l.replace(/\[[^\]]*\]/, ''))
    .map((l) => l.split(/[<>=!~;\s]/)[0])
    .filter(Boolean)
    .map(normalizePyName);
}

// Pragmatic, not a full TOML parser — only the dep shapes we care about.
export function parsePyprojectToml(content: string): string[] {
  const deps: string[] = [];

  for (const m of content.matchAll(/dependencies\s*=\s*\[([^\]]*)\]/g)) {
    for (const s of m[1].matchAll(/["']([^"']+)["']/g)) {
      const raw = s[1].replace(/\[[^\]]*\]/, '');
      const name = raw.split(/[<>=!~;\s]/)[0];
      if (name) deps.push(normalizePyName(name));
    }
  }

  const poetryRe =
    /\[tool\.poetry\.(?:dev-dependencies|dependencies|group\.[^.\]]+\.dependencies)\]([\s\S]*?)(?=\n\[|$)/g;
  for (const m of content.matchAll(poetryRe)) {
    deps.push(...extractTomlSectionKeys(m[1], { skip: ['python'] }));
  }

  return deps;
}

export function parsePipfile(content: string): string[] {
  const deps: string[] = [];
  const re = /\[(packages|dev-packages)\]([\s\S]*?)(?=\n\[|$)/g;
  for (const m of content.matchAll(re)) {
    deps.push(...extractTomlSectionKeys(m[2]));
  }
  return deps;
}

function extractTomlSectionKeys(
  body: string,
  opts: { skip?: string[] } = {},
): string[] {
  const skip = new Set(opts.skip ?? []);
  const out: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue;
    if (skip.has(name.toLowerCase())) continue;
    out.push(normalizePyName(name));
  }
  return out;
}
