/**
 * Feature discovery — scan project dependencies for known SDK patterns
 * that indicate additional PostHog programs are relevant.
 *
 * Pure function: takes an install dir, returns a set of discovered features.
 * No store mutations, no UI calls.
 */

import { join } from 'path';
import { readProjectFile } from '@utils/bounded-fs';
import { DiscoveredFeature } from '@shared/discovered-feature';
import { parsePackageJson } from '@utils/package-json';
import {
  parsePipfile,
  parsePyprojectToml,
  parseRequirementsTxt,
} from '../project-discovery/manifests/pypi';

const STRIPE_PACKAGES = new Set(['stripe', '@stripe/stripe-js']);

const LLM_PACKAGES = new Set([
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
]);

// PyPI normalizes `_` to `-` and is case-insensitive; compare via normalizePyName.
const PYTHON_LLM_PACKAGES = new Set([
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
]);

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

  const packageJson = parsePackageJson(packageJsonText);
  if (!packageJson) return;

  const depNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });

  if (depNames.some((depName) => STRIPE_PACKAGES.has(depName))) {
    features.push(DiscoveredFeature.Stripe);
  }
  if (depNames.some((depName) => LLM_PACKAGES.has(depName))) {
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

  if (depNames.some((depName) => PYTHON_LLM_PACKAGES.has(depName))) {
    features.push(DiscoveredFeature.LLM);
  }
}

// Manifests over MAX_PROJECT_FILE_BYTES are skipped, not parsed.
function safeRead(installDir: string, file: string): string | null {
  return readProjectFile(join(installDir, file));
}
