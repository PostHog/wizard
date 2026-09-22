/** How a PostHog SDK is recognized in a project manifest, for every scanner that greps one. */

// Matches `posthog` at a dependency boundary (line start, or after "'/=:.@ or
// whitespace): catches `com.posthog:posthog-android` and `@posthog/ai`, skips
// substrings inside other words.
export const POSTHOG_PACKAGE_RE = /(^|["'\s/=:.@])posthog/im;
