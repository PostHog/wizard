import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ToolCatalog } from '@programs/warehouse-sources/types';

const CATALOG: ToolCatalog = {
  schema_version: 1,
  tools: [
    {
      kind: 'Statsig',
      label: 'Statsig',
      warehouse_source_type: null,
      wizard_setup_mode: null,
      competes_with: ['feature_flags'],
      superseded_by: [],
      signals: {
        env_key_patterns: [],
        script_hosts: [],
        packages: { npm: ['statsig-js'] },
      },
    },
    {
      kind: 'Mixpanel',
      label: 'Mixpanel',
      warehouse_source_type: 'Mixpanel',
      wizard_setup_mode: 'in-cli',
      competes_with: ['product_analytics'],
      superseded_by: [],
      signals: {
        env_key_patterns: [],
        script_hosts: [],
        packages: { pypi: ['mixpanel'], 'not-an-ecosystem-yet': ['mixpanel'] },
      },
    },
  ],
};

vi.mock('@programs/warehouse-sources/registry.generated', () => ({
  TOOL_CATALOG: CATALOG,
}));

describe('detection against catalog shapes a sync can bring in', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-shape-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('never offers a tool without a setup mode as a warehouse source', async () => {
    const { detectWarehouseSources } = await import(
      '@programs/warehouse-sources/detect'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { 'statsig-js': '^5.0.0' } }),
    );
    expect(detectWarehouseSources(tmpDir)).toEqual([]);
  });

  it('ignores an ecosystem it has no parser for and still matches the rest', async () => {
    const { detectWarehouseSources } = await import(
      '@programs/warehouse-sources/detect'
    );
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'mixpanel==4.10\n');
    expect(detectWarehouseSources(tmpDir)).toEqual([
      {
        kind: 'Mixpanel',
        label: 'Mixpanel',
        mode: 'in-cli',
        matchedSignal: 'found `mixpanel` in Python dependencies',
      },
    ]);
  });
});
