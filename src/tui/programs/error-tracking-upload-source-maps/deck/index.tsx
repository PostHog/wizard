/** Source-maps learn-deck: the shared source-maps narrative, worded for the upload program. */

import type { WizardStore } from '@tui/store';
import type { ContentBlock } from '@tui/primitives/content-types';
import { buildSourceMapsDeck } from '@tui/programs/shared/deck/source-maps';

export const getContentBlocks = (store?: WizardStore): ContentBlock[] =>
  buildSourceMapsDeck(store, {
    intro: "I'm wiring PostHog Error Tracking into your build.",
    wiring:
      "Right now I'm hooking source-map generation and upload into your build, tied to each release you ship.",
  });
