vi.mock(import('@utils/analytics'), () => ({
  analytics: { wizardCapture: vi.fn() } as never,
}));

import { toSourceDetectors } from '@services/warehouse-sources/registry';
import { toWarehouseDestinations } from '@services/warehouse-sources/detect';
import type { DetectedTool } from '@services/warehouse-sources/types';

function catalogTool(kind: string, extra: Record<string, unknown> = {}) {
  return {
    kind,
    label: `${kind} label`,
    warehouse_source_type: kind,
    wizard_setup_mode: 'in-cli',
    superseded_by: [],
    signals: { env_key_patterns: [], script_hosts: [], packages: {} },
    ...extra,
  };
}

const catalog = (...tools: unknown[]) => ({ schema_version: 1, tools });

function detectedTool(kind: string): DetectedTool {
  return {
    kind,
    label: `${kind} label`,
    warehouseSourceType: kind,
    mode: 'in-cli',
    matchedSignal: `${kind.toLowerCase()} in package.json`,
    signals: [],
  };
}

describe('toSourceDetectors destination type', () => {
  it.each([
    [
      'explicit type',
      catalogTool('Acme', { warehouse_destination_type: 'S3' }),
      'S3',
    ],
    [
      'explicit null beats the legacy map',
      catalogTool('Snowflake', { warehouse_destination_type: null }),
      null,
    ],
    ['absent field, legacy warehouse', catalogTool('Snowflake'), 'Snowflake'],
    ['absent field, legacy AzureBlob', catalogTool('AzureBlob'), 'AzureBlob'],
    ['absent field, Postgres stays out', catalogTool('Postgres'), null],
    ['absent field, not a warehouse', catalogTool('Stripe'), null],
  ])('%s', (_name, tool, expected) => {
    const [detector] = toSourceDetectors(catalog(tool));
    expect(detector.warehouseDestinationType).toBe(expected);
  });

  it.each([
    ['an unknown type', 'Oracle'],
    ['a lowercase type', 'snowflake'],
    ['a number', 7],
  ])('skips a tool whose destination type is %s', (_name, value) => {
    const detectors = toSourceDetectors(
      catalog(
        catalogTool('Bad', { warehouse_destination_type: value }),
        catalogTool('Good'),
      ),
    );
    expect(detectors.map((d) => d.kind)).toEqual(['Good']);
  });
});

describe('toWarehouseDestinations', () => {
  const detectors = toSourceDetectors(
    catalog(
      catalogTool('Snowflake'),
      catalogTool('BigQuery'),
      catalogTool('Postgres'),
      catalogTool('Stripe'),
      catalogTool('SnowflakeSnowpark', {
        warehouse_destination_type: 'Snowflake',
      }),
      catalogTool('Minio', { warehouse_destination_type: 'S3' }),
    ),
  );

  it.each([
    ['nothing detected', [], []],
    ['only non-warehouse tools', ['Stripe', 'Postgres'], []],
    ['one warehouse', ['Snowflake'], ['Snowflake']],
    [
      'keeps detection order',
      ['BigQuery', 'Stripe', 'Snowflake'],
      ['BigQuery', 'Snowflake'],
    ],
    ['one entry per type', ['SnowflakeSnowpark', 'Snowflake'], ['Snowflake']],
    ['catalog-only type', ['Minio'], ['S3']],
    ['tool missing from the catalog', ['Unknown', 'BigQuery'], ['BigQuery']],
  ])('%s', (_name, kinds, expected) => {
    const destinations = toWarehouseDestinations(
      kinds.map(detectedTool),
      detectors,
    );
    expect(destinations.map((d) => d.type)).toEqual(expected);
  });

  it('carries the first matching tool label and signal', () => {
    const [destination] = toWarehouseDestinations(
      [detectedTool('SnowflakeSnowpark'), detectedTool('Snowflake')],
      detectors,
    );
    expect(destination).toEqual({
      type: 'Snowflake',
      label: 'SnowflakeSnowpark label',
      matchedSignal: 'snowflakesnowpark in package.json',
    });
  });
});
