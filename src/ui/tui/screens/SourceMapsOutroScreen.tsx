/**
 * SourceMapsOutroScreen — post-run summary for the source-maps upload flow.
 *
 * Unlike the generic OutroScreen, this spells out the operational facts a user
 * needs to actually get de-minified stack traces: that packages were installed
 * and upload credentials written to .env, plus the three gotchas (builds
 * upload, run the build, give CI the same credentials). All static guidance —
 * driven only by the program's `buildOutroData` (kind / message / report /
 * docs), no per-run data.
 */

import { join } from 'node:path';
import type { ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { OutroKind } from '@lib/wizard-session';
import { Colors } from '@ui/tui/styles';

interface SourceMapsOutroScreenProps {
  store: WizardStore;
}

export const SourceMapsOutroScreen = ({
  store,
}: SourceMapsOutroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  useInput((_input, key) => {
    // Ignore modifier-combo keypresses (e.g. Ctrl+T toggling the token/cost
    // HUD) — see AuthErrorScreen for why this guard is needed.
    if (key.ctrl || key.meta) return;
    store.setOutroDismissed();
  });

  const outroData = store.session.outroData;

  if (!outroData) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text dimColor>Finishing up...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {outroData.kind === OutroKind.Success && (
        <Box flexDirection="column">
          <Text color={Colors.success} bold>
            ✔ {outroData.message || 'Source maps wired up!'}
          </Text>

          <Section title="What the wizard did">
            <Text>• Installed the packages needed for source map upload.</Text>
            <Text>
              • Wrote the PostHog upload credentials to your{' '}
              <Text bold>.env</Text> file.
            </Text>
          </Section>

          <Section title="How uploads work now">
            <Text>
              • Every <Text bold>build</Text> now uploads source maps to PostHog
              automatically — no extra command to remember.
            </Text>
            <Text>
              • Run your app from the <Text bold>built output</Text>. Source
              maps only resolve for errors thrown by the build that was
              uploaded.
            </Text>
            <Text>
              • In <Text bold>CI</Text>, the build job needs the same upload
              credentials. If the wizard wired your pipeline, add the referenced
              secrets to your CI provider (e.g. GitHub repo secrets) before your
              next deploy.
            </Text>
          </Section>

          {outroData.reportFile && (
            <Box marginTop={1}>
              <Text>
                Details in{' '}
                <Text bold>
                  {join(store.session.installDir, outroData.reportFile)}
                </Text>
              </Text>
            </Box>
          )}

          {outroData.docsUrl && (
            <Box marginTop={1}>
              <Text>
                Learn more:{' '}
                <Text color={Colors.primary}>{outroData.docsUrl}</Text>
              </Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Note: This wizard uses an LLM agent to analyze and modify your
              project. Please review the changes made.
            </Text>
          </Box>
          <Text dimColor>
            How did this work for you? Drop us a line: wizard@posthog.com
          </Text>
        </Box>
      )}

      {outroData.kind === OutroKind.Error && (
        <Box flexDirection="column">
          <Text color={Colors.error} bold>
            ✘ {outroData.message || 'An error occurred'}
          </Text>
          {outroData.body && (
            <Box marginTop={1}>
              <Text dimColor>{outroData.body}</Text>
            </Box>
          )}
          {outroData.docsUrl && (
            <Box marginTop={1}>
              <Text>
                Docs: <Text color={Colors.primary}>{outroData.docsUrl}</Text>
              </Text>
            </Box>
          )}
        </Box>
      )}

      {outroData.kind === OutroKind.Cancel && (
        <Text color="yellow">■ {outroData.message || 'Cancelled'}</Text>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to continue</Text>
      </Box>
    </Box>
  );
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <Box flexDirection="column" marginTop={1}>
    <Text color={Colors.primary} bold>
      {title}:
    </Text>
    {children}
  </Box>
);
