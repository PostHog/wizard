import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ErrorCodes } from '@store';
import { PHW_ERROR_PREFIX } from '@store/shared/errors/emit';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(HERE, '../../../bin.ts'), 'utf8');

describe('bin.ts preflight', () => {
  it('loads no surface before the Node version check', () => {
    const statics =
      source.match(/^import .* from '(@|\.\/src\/)[^']*';$/gm) ?? [];
    expect(statics).toEqual([]);
    expect(source).toContain("await import('./src/cli/main.js')");
  });

  it('prints the same machine readable line as emitWizardError', () => {
    expect(source).toContain(`${PHW_ERROR_PREFIX} \${JSON.stringify({`);
    expect(source).toContain(`code: '${ErrorCodes.CliNodeVersion}'`);
  });
});
