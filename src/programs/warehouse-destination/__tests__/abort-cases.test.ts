import { WAREHOUSE_DESTINATION_ABORT_CASES } from '@programs/warehouse-destination';

const matching = (reason: string) =>
  WAREHOUSE_DESTINATION_ABORT_CASES.filter((c) => c.match.test(reason)).map(
    (c) => c.message,
  );

describe('WAREHOUSE_DESTINATION_ABORT_CASES', () => {
  it.each([
    [
      'Warehouse destinations not enabled',
      'Warehouse destinations are not enabled',
    ],
    [
      'warehouse destinations not enabled.',
      'Warehouse destinations are not enabled',
    ],
    ['Warehouse connection not saved', 'Warehouse connection not saved'],
    ['WAREHOUSE CONNECTION NOT SAVED.', 'Warehouse connection not saved'],
    ['Warehouse connection test failed', 'Warehouse connection test failed'],
  ])('maps "%s" to one case', (reason, message) => {
    expect(matching(reason)).toEqual([message]);
  });

  it.each([
    'No data source detected',
    'Warehouse connection not saved because of X',
    'warehouse destinations',
    '',
  ])('ignores "%s"', (reason) => {
    expect(matching(reason)).toEqual([]);
  });
});
