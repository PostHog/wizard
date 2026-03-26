import {
  MIGRATION_PRICING_CARDS,
  formatSavingsPercent,
  getMigrationPricingCardByAdditionalFeature,
  getMigrationPricingSelectionDetailLines,
  type MigrationPricingCard,
} from '../competitor-pricing.js';
import { AdditionalFeature } from '../wizard-session.js';

describe('competitor pricing registry', () => {
  it('keeps competitor pricing cards in a stable order', () => {
    expect(
      MIGRATION_PRICING_CARDS.map((card) => card.migrationFeature),
    ).toEqual([
      AdditionalFeature.AmplitudeMigration,
      AdditionalFeature.SentryMigration,
      AdditionalFeature.LaunchDarklyMigration,
      AdditionalFeature.BraintrustMigration,
    ]);
  });

  it('stores the benchmark assumptions and prices for Amplitude', () => {
    const card = getMigrationPricingCardByAdditionalFeature(
      AdditionalFeature.AmplitudeMigration,
    );

    expect(card).toBeDefined();
    expect(card).toMatchObject({
      posthogProducts: ['Product Analytics'],
      assumptions: [
        'Amplitude Plus monthly pricing at 100k MTUs.',
        'Assume about 20 identified events per MTU per month in PostHog.',
      ],
      benchmark: {
        usageLabel: '100k MTUs/mo',
        beforeMonthlyUsd: 1061,
        afterMonthlyUsd: 50,
      },
    });
  });

  it('supports migrations that map to multiple PostHog products', () => {
    const card: MigrationPricingCard = {
      migrationFeature: AdditionalFeature.SentryMigration,
      posthogProducts: ['Error Tracking', 'Logs'],
      assumptions: ['Assume the benchmark includes errors and logs.'],
      benchmark: {
        usageLabel: '500k logs/mo + 50k exceptions/mo',
        beforeMonthlyUsd: 180,
        afterMonthlyUsd: 75,
      },
    };

    expect(card.benchmark).toEqual({
      usageLabel: '500k logs/mo + 50k exceptions/mo',
      beforeMonthlyUsd: 180,
      afterMonthlyUsd: 75,
    });
    expect(card.posthogProducts).toEqual(['Error Tracking', 'Logs']);
  });

  it('builds compact selection-menu detail lines from a pricing card', () => {
    const card = getMigrationPricingCardByAdditionalFeature(
      AdditionalFeature.AmplitudeMigration,
    );

    expect(card).toBeDefined();
    expect(getMigrationPricingSelectionDetailLines(card!)).toEqual([
      {
        parts: [
          {
            text: '$1,061/mo -> $50/mo',
          },
          {
            text: ' | ',
          },
          {
            text: 'You could be paying 95% less with PostHog',
            bold: true,
            color: 'success',
          },
        ],
      },
      {
        text: 'At 100k MTUs/mo',
      },
    ]);
  });

  it('formats savings percentages from rounded cents', () => {
    expect(formatSavingsPercent(1061, 50)).toBe('95% less');
    expect(formatSavingsPercent(131.65, 107.75)).toBe('18% less');
  });

  it('requires benchmarks to show PostHog savings', () => {
    expect(() => formatSavingsPercent(100, 100)).toThrow(
      'Migration pricing benchmark must show PostHog savings.',
    );
  });
});
