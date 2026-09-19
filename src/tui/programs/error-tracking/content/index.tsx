/** Error-tracking learn-deck: the source-maps narrative, worded to also fit platforms that upload nothing. */

import type { WizardStore } from '@store/types';
import type { ContentBlock } from '../../../primitives/content-types.js';
import { buildSourceMapsDeck } from '../../error-tracking-upload-source-maps/content/index.js';

export const getContentBlocks = (store?: WizardStore): ContentBlock[] =>
  buildSourceMapsDeck(store, {
    intro: "I'm wiring PostHog Error Tracking into your project.",
    wiring:
      'If your platform ships minified code or stripped binaries, I also hook source-map or debug-symbol upload into your build, tied to each release you ship.',
  });
