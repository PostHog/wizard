/**
 * Dependency parsers for the manifests of every ecosystem the wizard installs
 * into, one ecosystem per file. Each returns the version text the manifest
 * declares per package, empty when it names none, by package names in the form
 * the PostHog tool catalog lists them for that ecosystem. Regex-based on
 * purpose: a manifest is read for names and versions only, so a full parser
 * per language buys nothing, and a malformed file yields fewer names instead
 * of an error.
 */

import { parseCargoToml } from './cargo';
import { parsePodfile } from './cocoapods';
import { parseComposerJson } from './composer';
import { parseGoMod } from './go';
import { parseMixExs } from './hex';
import {
  parseGradleBuild,
  parseGradleVersionCatalog,
  parsePomXml,
} from './maven';
import { parsePackageJson } from './npm';
import { parsePubspecYaml } from './pub';
import { parsePipfile, parsePyprojectToml, parseRequirementsTxt } from './pypi';
import { parseGemfile } from './rubygems';
import { parsePackageSwift } from './swiftpm';

/** `parse` returns null for a file it can't read as that manifest. */
export type ManifestParser = {
  /** Package ecosystem: `npm`, `pypi`, `rubygems`, `cargo`, ... */
  ecosystem: string;
  parse: (content: string) => Record<string, string> | null;
};

/** Every manifest the wizard reads, by file name. A map, so a file named `constructor` finds no parser. */
export const MANIFEST_PARSERS: ReadonlyMap<string, ManifestParser> = new Map<
  string,
  ManifestParser
>([
  ['package.json', { ecosystem: 'npm', parse: parsePackageJson }],
  ['requirements.txt', { ecosystem: 'pypi', parse: parseRequirementsTxt }],
  ['pyproject.toml', { ecosystem: 'pypi', parse: parsePyprojectToml }],
  ['Pipfile', { ecosystem: 'pypi', parse: parsePipfile }],
  ['Gemfile', { ecosystem: 'rubygems', parse: parseGemfile }],
  ['Cargo.toml', { ecosystem: 'cargo', parse: parseCargoToml }],
  ['Podfile', { ecosystem: 'cocoapods', parse: parsePodfile }],
  ['composer.json', { ecosystem: 'composer', parse: parseComposerJson }],
  ['go.mod', { ecosystem: 'go', parse: parseGoMod }],
  ['mix.exs', { ecosystem: 'hex', parse: parseMixExs }],
  ['build.gradle', { ecosystem: 'maven', parse: parseGradleBuild }],
  ['build.gradle.kts', { ecosystem: 'maven', parse: parseGradleBuild }],
  [
    'libs.versions.toml',
    { ecosystem: 'maven', parse: parseGradleVersionCatalog },
  ],
  ['pom.xml', { ecosystem: 'maven', parse: parsePomXml }],
  ['pubspec.yaml', { ecosystem: 'pub', parse: parsePubspecYaml }],
  ['Package.swift', { ecosystem: 'swiftpm', parse: parsePackageSwift }],
]);

export {
  parseCargoToml,
  parseComposerJson,
  parseGemfile,
  parseGoMod,
  parseGradleBuild,
  parseGradleVersionCatalog,
  parseMixExs,
  parsePackageJson,
  parsePackageSwift,
  parsePipfile,
  parsePodfile,
  parsePomXml,
  parsePubspecYaml,
  parsePyprojectToml,
  parseRequirementsTxt,
};
