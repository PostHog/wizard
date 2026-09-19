/**
 * The detection picks a headless run supplies where the real screen would show
 * an interactive picker: the project to set up, and the source-maps variant.
 * Computed here, on the parent's side of the socket, and committed through the
 * program's control actions.
 */
import fs from 'fs';
import { join } from 'path';
import { FRAMEWORK_REGISTRY, buildSession, detectFramework } from '@store';
import {
  detectSourceMapsPrerequisites,
  SOURCE_MAPS_CONTEXT_KEYS,
} from '@store/programs';
import type { Integration } from '@store/types';

/**
 * The repo root for a single app, else the first instrumentable sub-app of a
 * monorepo under `apps/` or `packages/`.
 */
export async function pickIntegrationTarget(
  root: string,
): Promise<{ integration: Integration; path: string } | null> {
  for (const group of ['apps', 'packages']) {
    let entries: string[];
    try {
      entries = fs.readdirSync(join(root, group)).sort();
    } catch {
      continue;
    }
    for (const name of entries) {
      const rel = `${group}/${name}`;
      if (!fs.statSync(join(root, rel)).isDirectory()) continue;
      const fw = await detectFramework(join(root, rel));
      if (fw && FRAMEWORK_REGISTRY[fw]) return { integration: fw, path: rel };
    }
  }
  const rootFw = await detectFramework(root);
  return rootFw && FRAMEWORK_REGISTRY[rootFw]
    ? { integration: rootFw, path: '.' }
    : null;
}

/**
 * The variant to drive when the static prerequisite detector names none: the
 * platform it recognised but would not automate, else the manifest that
 * identifies a Go, Rust, Flutter, iOS, or Android fixture.
 */
export function nativeVariantFor(
  root: string,
  detectError: unknown,
): string | null {
  const detected = (detectError as { detected?: string } | undefined)?.detected;
  if (detected && detected !== 'unknown') return detected;
  const manifests: ReadonlyArray<readonly [string, string]> = [
    ['go.mod', 'go'],
    ['Cargo.toml', 'rust'],
    ['pubspec.yaml', 'flutter'],
    ['Package.swift', 'ios'],
    ['settings.gradle.kts', 'android'],
    ['settings.gradle', 'android'],
  ];
  for (const [file, variant] of manifests) {
    if (fs.existsSync(join(root, file))) return variant;
  }
  try {
    if (
      fs
        .readdirSync(root)
        .some((f) => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))
    ) {
      return 'ios';
    }
  } catch {
    /* unreadable root: the caller reports the original detect error */
  }
  return null;
}

/** The source-maps variant for a fixture, or the detect error when none applies. */
export function pickSourceMapsVariant(
  root: string,
): { variant: string; fallback: boolean } | { error: unknown } {
  const ctx: Record<string, unknown> = {};
  detectSourceMapsPrerequisites(
    buildSession({ installDir: root }),
    (k: string, v: unknown) => {
      ctx[k] = v;
    },
  );
  const detected = ctx[SOURCE_MAPS_CONTEXT_KEYS.skillVariant];
  if (typeof detected === 'string')
    return { variant: detected, fallback: false };
  const native = nativeVariantFor(
    root,
    ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError],
  );
  return native
    ? { variant: native, fallback: true }
    : { error: ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError] };
}
