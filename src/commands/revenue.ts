import { CLI_MANIFEST } from '@lib/programs/cli-manifest.generated';
import { revenueAnalyticsConfig } from '@lib/programs/revenue-analytics/index';

import type { Command } from './command';
import { createFamilyPickerDefault } from './factories/family-picker';
import { skillCommandFactory } from './factories/skill-command-factory';

/**
 * The `wizard revenue` family. One child per manifest entry under
 * `parentCommand: 'revenue'` (today just `stripe`, marked default).
 *
 * `wizard revenue` with no subcommand runs the default child directly —
 * no picker required when there's a clear default. When a second
 * provider lands, the existing default keeps running for users who
 * type `wizard revenue` without args; adding a child doesn't break
 * existing usage.
 */
const revenueChildren = CLI_MANIFEST.entries
  .filter(
    (entry) => entry.surface === 'public' && entry.parentCommand === 'revenue',
  )
  .map((entry) => skillCommandFactory(entry, revenueAnalyticsConfig));

export const revenueCommand: Command = {
  name: 'revenue',
  description: revenueAnalyticsConfig.description,
  children: revenueChildren,
  interactiveDefault: createFamilyPickerDefault(
    'wizard revenue',
    revenueChildren,
  ),
};
