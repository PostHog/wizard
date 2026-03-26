import { AdditionalFeature } from './wizard-session.js';

export interface MigrationPricingBenchmark {
  usageLabel: string;
  beforeMonthlyUsd: number;
  afterMonthlyUsd: number;
}

export interface MigrationPricingCard {
  migrationFeature: AdditionalFeature;
  posthogProducts: string[];
  assumptions: string[];
  benchmark: MigrationPricingBenchmark;
}

interface ComparisonSelectionDetailLine {
  text?: string;
  bold?: boolean;
  parts?: Array<{
    text: string;
    bold?: boolean;
    color?: 'success';
  }>;
}

export const MIGRATION_PRICING_CARDS: MigrationPricingCard[] = [
  {
    migrationFeature: AdditionalFeature.AmplitudeMigration,
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
  },
  {
    migrationFeature: AdditionalFeature.SentryMigration,
    posthogProducts: ['Error Tracking'],
    assumptions: [
      'Sentry Team monthly pricing at 500k exceptions.',
      'Treat 1 Sentry error as 1 PostHog exception.',
    ],
    benchmark: {
      usageLabel: '500k exceptions/mo',
      beforeMonthlyUsd: 131.65,
      afterMonthlyUsd: 107.75,
    },
  },
  {
    migrationFeature: AdditionalFeature.LaunchDarklyMigration,
    posthogProducts: ['Feature Flags'],
    assumptions: [
      'LaunchDarkly Foundation monthly pricing at 50k client MAU and 8 service connections.',
      'Assume about 30 PostHog flag requests per client-side MAU per month.',
    ],
    benchmark: {
      usageLabel: '50k client MAU + 8 service connections',
      beforeMonthlyUsd: 596,
      afterMonthlyUsd: 50,
    },
  },
  {
    migrationFeature: AdditionalFeature.BraintrustMigration,
    posthogProducts: ['LLM Analytics'],
    assumptions: [
      'Braintrust Starter monthly pricing at 500k LLM events.',
      'Assume Braintrust scoring and processed-data usage follows the benchmark scenario.',
    ],
    benchmark: {
      usageLabel: '500k LLM events/mo',
      beforeMonthlyUsd: 281.48,
      afterMonthlyUsd: 24,
    },
  },
];

function roundUsd(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function formatUsd(amount: number): string {
  const rounded = roundUsd(amount);
  const hasCents = !Number.isInteger(rounded);

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rounded);
}

export function formatUsdMonthly(amount: number): string {
  return `${formatUsd(amount)}/mo`;
}

export function formatSavingsPercent(
  beforeAmount: number,
  afterAmount: number,
): string {
  const beforeCents = toCents(beforeAmount);
  const afterCents = toCents(afterAmount);

  if (beforeCents <= 0 || afterCents >= beforeCents) {
    throw new Error('Migration pricing benchmark must show PostHog savings.');
  }

  const percent = Math.max(
    1,
    Math.round(((beforeCents - afterCents) * 100) / beforeCents),
  );

  return `${percent}% less`;
}

export function getMigrationPricingCardByAdditionalFeature(
  feature: AdditionalFeature,
): MigrationPricingCard | undefined {
  return MIGRATION_PRICING_CARDS.find(
    (card) => card.migrationFeature === feature,
  );
}

export function getMigrationPricingSelectionDetailLines(
  card: MigrationPricingCard,
): ComparisonSelectionDetailLine[] {
  const savingsPercent = formatSavingsPercent(
    card.benchmark.beforeMonthlyUsd,
    card.benchmark.afterMonthlyUsd,
  );
  const pricingLine = `${formatUsdMonthly(
    card.benchmark.beforeMonthlyUsd,
  )} -> ${formatUsdMonthly(card.benchmark.afterMonthlyUsd)}`;

  return [
    {
      parts: [
        { text: pricingLine },
        { text: ' | ' },
        {
          text: `You could be paying ${savingsPercent} with PostHog`,
          bold: true,
          color: 'success',
        },
      ],
    },
    {
      text: `At ${card.benchmark.usageLabel}`,
    },
  ];
}
