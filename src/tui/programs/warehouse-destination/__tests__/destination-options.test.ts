import {
  allDestinationOptions,
  mainOptions,
} from '../screens/WarehouseDestinationIntroScreen.js';

// PickerMenu adds a filter row at 10 options; the intro also appends "Privacy & data".
const FILTER_MIN_OPTIONS = 10;

describe('mainOptions', () => {
  it.each([
    [
      'nothing detected',
      [],
      ['choose', 'no-warehouse', 'more-info'],
      'Choose a warehouse',
    ],
    [
      'one detected',
      ['Snowflake'],
      ['Snowflake', 'choose', 'no-warehouse', 'more-info'],
      'A different warehouse',
    ],
    [
      'several detected keep detection order',
      ['S3', 'BigQuery'],
      ['S3', 'BigQuery', 'choose', 'no-warehouse', 'more-info'],
      'A different warehouse',
    ],
  ] as const)('%s', (_name, detected, values, chooseLabel) => {
    const options = mainOptions(detected);
    expect(options.map((o) => o.value)).toEqual(values);
    expect(options.find((o) => o.value === 'choose')?.label).toBe(chooseLabel);
  });

  it('marks only detected rows', () => {
    const hinted = mainOptions(['Redshift'])
      .filter((o) => o.hint === 'detected')
      .map((o) => o.value);
    expect(hinted).toEqual(['Redshift']);
  });
});

describe('allDestinationOptions', () => {
  it('lists every type, then Back', () => {
    expect(allDestinationOptions().map((o) => o.value)).toEqual([
      'BigQuery',
      'Snowflake',
      'Redshift',
      'Databricks',
      'Postgres',
      'S3',
      'AzureBlob',
      'back',
    ]);
  });

  it('stays under the filter threshold with the privacy row added', () => {
    expect(allDestinationOptions().length + 1).toBeLessThan(FILTER_MIN_OPTIONS);
  });
});
