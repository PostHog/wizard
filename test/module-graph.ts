/** The repo's module resolver, shared by the architecture test and the entry closure checks. */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as ts from 'typescript';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export type Aliases = ReadonlyArray<readonly [string, string]>;

export function toRepoRelative(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

function isFile(abs: string): boolean {
  return fs.statSync(abs, { throwIfNoEntry: false })?.isFile() ?? false;
}

export function loadAliases(): Aliases {
  const tsconfig = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.build.json'), 'utf8'),
  ) as { compilerOptions?: { paths?: Record<string, string[]> } };
  return Object.entries(tsconfig.compilerOptions?.paths ?? {}).map(
    ([pattern, targets]) => [pattern, targets[0]] as const,
  );
}

export function aliasTarget(spec: string, aliases: Aliases): string | null {
  for (const [pattern, target] of aliases) {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (spec.startsWith(prefix)) {
        return path.resolve(
          REPO_ROOT,
          target.slice(0, -1) + spec.slice(prefix.length),
        );
      }
    } else if (spec === pattern) {
      return path.resolve(REPO_ROOT, target);
    }
  }
  return null;
}

export function probe(base: string): string | null {
  const candidates: string[] = [];
  if (base.endsWith('.js')) {
    const stem = base.slice(0, -3);
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  }
  candidates.push(
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    base,
  );
  return candidates.find(isFile) ?? null;
}

/** A file's transpiled output: what runs, with type-only imports erased. */
export function transpiled(file: string): string {
  const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  return ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
}

/** Repo files that load with `entry`: static imports and re-exports, plus `import()` when `includeDynamic`. */
export function staticImportClosure(
  entry: string,
  includeDynamic = false,
): string[] {
  const aliases = loadAliases();
  const pending = [entry];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const specs: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specs.push(node.moduleSpecifier.text);
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        specs.push(node.arguments[0].text);
      }
      if (includeDynamic) ts.forEachChild(node, visit);
    };
    ts.createSourceFile(
      `${file}.js`,
      transpiled(file),
      ts.ScriptTarget.ES2022,
    ).statements.forEach(visit);
    for (const spec of specs) {
      const base = spec.startsWith('.')
        ? path.resolve(REPO_ROOT, path.dirname(file), spec)
        : aliasTarget(spec, aliases);
      const target = base && probe(base);
      if (target) pending.push(toRepoRelative(target));
    }
  }

  return [...visited].sort();
}
