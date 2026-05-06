import type { AreaSlide } from './shared.js';

export const LLMAnalyticsSlide: AreaSlide = {
  area: 'LLM Analytics',
  intro: [
    "We're checking that your AI generations are captured with `$ai_generation` events and that token counts plus cost properties are attached.",
    'Without these, model spend, latency, and prompt-level debugging stay invisible — and there is no path to evaluate quality across runs.',
  ],
  docsUrl: 'https://posthog.com/docs/ai-engineering',
};
