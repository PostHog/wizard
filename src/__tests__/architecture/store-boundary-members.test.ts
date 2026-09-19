import * as path from 'path';
import { fileURLToPath } from 'url';
import * as ts from 'typescript';
import { STORE_BOUNDARY_MEMBERS } from '@store';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const CONSUMER = /\/(src\/(tui|cli)|e2e-harness|scripts)\/|\/bin\.ts$/;

/** Every WizardStore member the other surfaces reach, from the type checker. */
function usedMembers(): string[] {
  const cfg = ts.getParsedCommandLineOfConfigFile(
    path.join(REPO_ROOT, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    },
  );
  if (!cfg) throw new Error('tsconfig.json did not parse');
  const roots = cfg.fileNames.filter(
    (f) => CONSUMER.test(f) && !/__tests__|\.test\.tsx?$/.test(f),
  );
  const program = ts.createProgram(roots, cfg.options);
  const checker = program.getTypeChecker();
  const rootSet = new Set(roots);
  const used = new Set<string>();

  const isStore = (node: ts.Node): boolean => {
    const type = checker.getTypeAtLocation(node);
    const parts = type.isUnion() ? type.types : [type];
    return parts.some((t) => t.getSymbol()?.getName() === 'WizardStore');
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isStore(node.expression)) {
      used.add(node.name.text);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectBindingPattern(node.name) &&
      isStore(node.initializer)
    ) {
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key)) used.add(key.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const sf of program.getSourceFiles()) {
    if (rootSet.has(sf.fileName)) visit(sf);
  }
  return [...used].sort();
}

describe('WizardStore boundary', () => {
  it('STORE_BOUNDARY_MEMBERS is exactly what tui, cli, and the harness use', () => {
    expect(usedMembers()).toEqual([...STORE_BOUNDARY_MEMBERS].sort());
  }, 120_000);
});
