import fs from 'fs';
import path from 'path';
import { ROUTES } from '@store/control';

/** The route table in ARCHITECTURE.md is the contract the workbench reads; it must name what the server answers. */
describe('the documented control API', () => {
  it('lists exactly the routes the server serves', () => {
    const doc = fs.readFileSync(
      path.resolve(__dirname, '../ARCHITECTURE.md'),
      'utf8',
    );
    const documented = new Set(
      [...doc.matchAll(/^\| `((?:GET|POST) \/[^`?]*)/gm)].map((m) =>
        m[1].replace(/<(\w+)>/g, ':$1').trim(),
      ),
    );
    expect([...documented].sort()).toEqual([...ROUTES].sort());
  });
});
