/**
 * Feature discovery — scan project dependencies for known SDK patterns
 * that indicate additional PostHog programs are relevant.
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
  const packageJsonText = safeRead(installDir, 'package.json');
  if (!packageJsonText) return;

  let packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    packageJson = JSON.parse(packageJsonText);
  } catch {
    return;
  }

  const depNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });

  if (depNames.some((depName) => STRIPE_PACKAGES.includes(depName))) {
    features.push(DiscoveredFeature.Stripe);
  }
  if (depNames.some((depName) => LLM_PACKAGES.includes(depName))) {
    features.push(DiscoveredFeature.LLM);
  }
}

function discoverPythonFeatures(
  installDir: string,
  features: DiscoveredFeature[],
): void {
  if (features.includes(DiscoveredFeature.LLM)) return;

  const depNames: string[] = [];

  const requirementsTxt = safeRead(installDir, 'requirements.txt');
  if (requirementsTxt) depNames.push(...parseRequirementsTxt(requirementsTxt));

  const pyprojectToml = safeRead(installDir, 'pyproject.toml');
  if (pyprojectToml) depNames.push(...parsePyprojectToml(pyprojectToml));

  const pipfile = safeRead(installDir, 'Pipfile');
  if (pipfile) depNames.push(...parsePipfile(pipfile));

  if (depNames.some((depName) => PYTHON_LLM_PACKAGES.includes(depName))) {
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
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
    .map((line) => line.replace(/\[[^\]]*\]/, ''))
    .map((line) => line.split(/[<>=!~;\s]/)[0])
    .filter(Boolean)
    .map(normalizePyName);
}

// Pragmatic, not a full TOML parser — only the dep shapes we care about.
export function parsePyprojectToml(content: string): string[] {
  const depNames: string[] = [];

  for (const arrayMatch of content.matchAll(
    /dependencies\s*=\s*\[([^\]]*)\]/g,
  )) {
    const arrayBody = arrayMatch[1];
    for (const quotedMatch of arrayBody.matchAll(/["']([^"']+)["']/g)) {
      const depSpec = quotedMatch[1];
      const name = depSpec.replace(/\[[^\]]*\]/, '').split(/[<>=!~;\s]/)[0];
      if (name) depNames.push(normalizePyName(name));
    }
  }

  const poetrySectionRe =
    /\[tool\.poetry\.(?:dev-dependencies|dependencies|group\.[^.\]]+\.dependencies)\]([\s\S]*?)(?=\n\[|$)/g;
  for (const sectionMatch of content.matchAll(poetrySectionRe)) {
    const sectionBody = sectionMatch[1];
    depNames.push(...extractTomlSectionKeys(sectionBody, { skip: ['python'] }));
  }

  return depNames;
}

export function parsePipfile(content: string): string[] {
  const depNames: string[] = [];
  const sectionRe = /\[(packages|dev-packages)\]([\s\S]*?)(?=\n\[|$)/g;
  for (const sectionMatch of content.matchAll(sectionRe)) {
    const sectionBody = sectionMatch[2];
    depNames.push(...extractTomlSectionKeys(sectionBody));
  }
  return depNames;
}

function extractTomlSectionKeys(
  sectionBody: string,
  opts: { skip?: string[] } = {},
): string[] {
  const skipNames = new Set(opts.skip ?? []);
  const depNames: string[] = [];
  for (const line of sectionBody.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;
    const name = trimmed.slice(0, equalsIndex).trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue;
    if (skipNames.has(name.toLowerCase())) continue;
    depNames.push(normalizePyName(name));
  }
  return depNames;
}
