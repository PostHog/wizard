/** The source-maps upload TUI: its flow, deck, screens and their commits. */
import {
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANT_DISPLAY_NAME,
} from '@programs/error-tracking-upload-source-maps';
import { BadParamError, requireString } from '@shared/control/params';
import { dismissOutro, type ActionDef } from '@tui/control/defs';
import type { TuiPrograms } from '@tui/programs/types';
import { ERROR_TRACKING_UPLOAD_SOURCE_MAPS_FLOW } from './flow.js';
import { getContentBlocks } from './deck/index.js';
import { SourceMapsScreenId } from './screen-ids.js';
import { SourceMapsIntroScreen } from './screens/SourceMapsIntroScreen.js';
import { SourceMapsDetectScreen } from './screens/SourceMapsDetectScreen.js';
import { SourceMapsOutroScreen } from './screens/SourceMapsOutroScreen.js';

export { SourceMapsScreenId } from './screen-ids.js';

const pickSourceMapsProject: ActionDef = {
  id: 'pick_source_maps_project',
  description:
    'Commit the project to upload source maps for, as the picker would: its path and SDK variant.',
  params: {
    path: 'project path relative to the repo root',
    variant: Object.keys(VARIANT_DISPLAY_NAME).join(' | '),
  },
  apply: (store, params) => {
    const path = requireString('pick_source_maps_project', params, 'path');
    const variant = requireString(
      'pick_source_maps_project',
      params,
      'variant',
    ) as keyof typeof VARIANT_DISPLAY_NAME;
    const displayName = VARIANT_DISPLAY_NAME[variant];
    if (!displayName) {
      throw new BadParamError(
        'pick_source_maps_project',
        'variant',
        `expected one of ${Object.keys(VARIANT_DISPLAY_NAME).join(', ')}`,
      );
    }
    store.setFrameworkContext(
      SOURCE_MAPS_CONTEXT_KEYS.selectedVariant,
      variant,
    );
    store.setFrameworkContext(
      SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName,
      displayName,
    );
    store.setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedPath, path);
  },
};

export const TUI_PROGRAMS: TuiPrograms = {
  'error-tracking-upload-source-maps': {
    flow: ERROR_TRACKING_UPLOAD_SOURCE_MAPS_FLOW,
    deck: getContentBlocks,
    screens: {
      [SourceMapsScreenId.Intro]: (store) => (
        <SourceMapsIntroScreen store={store} />
      ),
      [SourceMapsScreenId.Detect]: (store) => (
        <SourceMapsDetectScreen store={store} />
      ),
      [SourceMapsScreenId.Outro]: (store) => (
        <SourceMapsOutroScreen store={store} />
      ),
    },
    actions: {
      [SourceMapsScreenId.Detect]: [pickSourceMapsProject],
      [SourceMapsScreenId.Outro]: [dismissOutro],
    },
  },
};
