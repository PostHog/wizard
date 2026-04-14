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

/**
 * Scan `package.json` at `installDir` for dependencies that indicate
 * additional PostHog features (Stripe revenue analytics, LLM observability, etc.)
 *
 * Returns an array of discovered features, or empty if nothing found
 * or no package.json exists.
 */
export function discoverFeatures(installDir: string): DiscoveredFeature[] {
  const features: DiscoveredFeature[] = [];

  try {
    const pkg = JSON.parse(
      readFileSync(join(installDir, 'package.json'), 'utf-8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
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
  } catch {
    // No package.json or parse error — skip feature discovery
  }

  return features;
}
