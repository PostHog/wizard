/** Error-tracking learn-deck: the source-maps narrative, worded to also fit platforms that upload nothing. */

import type { WizardStore } from '@ui/tui/store';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import { buildSourceMapsDeck } from '@lib/programs/error-tracking-upload-source-maps/content/index';

export const getContentBlocks = (store?: WizardStore): ContentBlock[] =>
  buildSourceMapsDeck(store, {
    intro: "I'm wiring PostHog Error Tracking into your project.",
    wiring:
      'If your platform ships minified code or stripped binaries, I also hook source-map or debug-symbol upload into your build, tied to each release you ship.',
  });
