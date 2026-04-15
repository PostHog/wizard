/**
 * IntroScreenLayout ��� Shared visual shell for all workflow intro screens.
 *
 * Purely presentational — no store subscription. Parent components own
 * the store subscription and pass derived data as props.
 *
 * Slots:
 *   body  — free-form content below the title bar (copy, spinners, pickers, etc.)
 *   children     — between detection rows and menu (extra info, warnings)
 *   errorView    — replaces the entire body for fatal error states
 */

import path from 'path';
import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { PickerMenu } from '../primitives/index.js';

export interface DetectionRow {
  label: string;
  value: string;
  suffix?: string;
}

interface IntroScreenLayoutProps {
  /** Absolute path to the project directory */
  installDir: string;

  /** Title text after the colored blocks, e.g. "PostHog Wizard 🦔" */
  title?: string;

  /** Free-form content below the title (copy, spinners, pickers, notices) */
  body?: ReactNode;

  /** Detection row items rendered as "Label ✔ value suffix" */
  detectionRows?: DetectionRow[];

  /** Content rendered between detection rows and the menu */
  children?: ReactNode;

  /** Menu options. Pass null to hide the menu entirely. */
  menuOptions?: { label: string; value: string }[] | null;

  /** Called when the user picks a menu option */
  onSelect?: (value: string) => void;

  /** Workflow label shown at the bottom */
  workflowLabel?: string | null;

  /** Skill ID shown at the bottom  */
  skillId?: string | null;

  /** Replaces the entire body (topContent + rows + children + menu) for fatal error views */
  errorView?: ReactNode;
}

const WizardTitle = ({ title }: { title: string }) => (
  <Text bold>
    <Text color="#1D4AFF">{'\u2588'}</Text>
    <Text color="#F54E00">{'\u2588'}</Text>
    <Text color="#F9BD2B">{'\u2588'}</Text> {title}
  </Text>
);

export const IntroScreenLayout = ({
  installDir,
  title = 'PostHog Wizard 🦔',
  body,
  detectionRows,
  children,
  menuOptions,
  onSelect,
  workflowLabel,
  skillId,
  errorView,
}: IntroScreenLayoutProps) => {
  // Default menu: Continue / Cancel
  const resolvedMenuOptions =
    menuOptions === undefined
      ? [
          { label: 'Continue', value: 'continue' },
          { label: 'Cancel', value: 'cancel' },
        ]
      : menuOptions;

  if (errorView) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        <Box flexDirection="column" alignItems="center" marginBottom={1}>
          <WizardTitle title={title} />
        </Box>
        {errorView}
      </Box>
    );
  }

  return (
    <>
      <Box
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        <Box flexDirection="column" alignItems="center">
          <WizardTitle title={title} />

          <Box flexDirection="column" alignItems="center" marginTop={1}>
            <Text dimColor>
              We'll use AI to analyze your project and complete work.
            </Text>
            <Text dimColor>
              .env* file contents will not leave your machine.
            </Text>
          </Box>

          {body && (
            <Box flexDirection="column" alignItems="center" marginTop={1}>
              {body}
            </Box>
          )}
        </Box>

        {children}

        {detectionRows && detectionRows.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text>
                Directory <Text color="green">{'\u2714'}</Text>{' '}
              </Text>
              <Text>
                {'/'}
                {path.basename(installDir)}
              </Text>
            </Text>

            {detectionRows.map((row) => (
              <Text key={row.label}>
                <Text>
                  {row.label} <Text color="green">{'\u2714'}</Text>{' '}
                </Text>
                <Text>
                  {row.value}
                  {row.suffix ? ` ${row.suffix}` : ''}
                </Text>
              </Text>
            ))}

            {workflowLabel && (
              <Text>
                Workflow <Text color="green">{'\u2714'}</Text> {workflowLabel}
              </Text>
            )}

            {workflowLabel === 'agent-skill' && skillId && (
              <Text>
                Skill <Text color="green">{'\u2714'}</Text> {skillId}
              </Text>
            )}
          </Box>
        )}

        <Box width={24}>
          {resolvedMenuOptions && onSelect && (
            <Box justifyContent="center">
              <PickerMenu
                key={resolvedMenuOptions.map((o) => o.value).join(',')}
                options={resolvedMenuOptions}
                onSelect={(value) => {
                  const choice = Array.isArray(value) ? value[0] : value;
                  onSelect(choice);
                }}
              />
            </Box>
          )}
        </Box>
      </Box>
    </>
  );
};
