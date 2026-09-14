/**
 * IntroScreenLayout ��� Shared visual shell for all program intro screens.
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
import { useState, type ReactNode } from 'react';
import { PickerMenu, type PickerOption } from '@ui/tui/primitives/index';
import {
  PrivacyPanel,
  PRIVACY_PANEL_LABEL,
} from '@ui/tui/components/PrivacyPanel';

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

  /** Show the subtitle below the title. Default true. */
  showSubtitle?: boolean;

  /**
   * Custom subtitle content, rendered in place of the default
   * "We'll use AI… / .env*…" lines when `showSubtitle` is true. Pass the
   * inner <Text> lines — the layout owns the centered, top-margined
   * wrapper. Defaults to the generic subtitle when omitted.
   */
  subtitle?: ReactNode;

  /** Free-form content below the title (copy, spinners, pickers, notices) */
  body?: ReactNode;

  /** Show the detection block (Directory, detection rows, Program, Skill). Default true. */
  showDetection?: boolean;

  /** Extra detection row items rendered as "Label ✔ value suffix" */
  detectionRows?: DetectionRow[];

  /** Content rendered between detection rows and the menu */
  children?: ReactNode;

  /**
   * Menu options, forwarded to PickerMenu as-is — so a screen can mark a row
   * `disabled` (navigation skips it, which is how a blank spacer row works) or
   * give it an `icon`. Pass null to hide the menu entirely.
   */
  menuOptions?: PickerOption<string>[] | null;

  /**
   * Menu alignment. 'center' (default) matches the wizard's standard
   * intro menu. 'left' is for views like the privacy panel where the
   * menu should align with the panel content rather than viewport center.
   */
  menuAlign?: 'center' | 'left';

  /**
   * Adds the disclosure row to the menu and owns the view behind it, so every
   * program intro offers it at the top level rather than buried under More
   * info. Set false on screens that are not a program intro — the auth
   * overlay renders the panel itself and would otherwise nest inside itself.
   */
  showPrivacy?: boolean;

  /**
   * Rows shown above Back on the disclosure view, for a program that lets the
   * user act on what the panel describes. Their selections reach `onSelect`
   * like any other. Passing them also un-gates the panel's scan paragraph,
   * which points the reader at exactly these rows.
   */
  privacyOptions?: PickerOption<string>[];

  /** Called when the user picks a menu option */
  onSelect?: (value: string) => void;

  /** Program label shown at the bottom */
  programLabel?: string | null;

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

/** Generic subtitle shown when a screen doesn't supply its own. */
const DEFAULT_SUBTITLE = (
  <>
    <Text dimColor>
      We'll use AI to analyze your project and complete work.
    </Text>
    <Text dimColor>.env* file contents will not leave your machine.</Text>
  </>
);

/** Default menu when a screen passes none. */
const DEFAULT_MENU: PickerOption<string>[] = [
  { label: 'Continue', value: 'continue' },
  { label: 'Cancel', value: 'cancel' },
];

/**
 * The menu for the current view. The disclosure row is appended here rather
 * than left to each screen: ten intro screens would otherwise carry the same
 * row, view and back handler, which is how this panel came to answer to five
 * different names and to sit two levels deep on the one screen that had it.
 *
 * Pure and exported so the guarantee is testable without a renderer.
 */
export function buildIntroMenu({
  menuOptions,
  showPrivacy = true,
  showingPrivacy = false,
  privacyOptions,
}: {
  menuOptions?: PickerOption<string>[] | null;
  showPrivacy?: boolean;
  showingPrivacy?: boolean;
  privacyOptions?: PickerOption<string>[];
}): PickerOption<string>[] | null {
  if (showingPrivacy) {
    // Always supplied here, so a program cannot strand the user by omitting
    // it. A blank glyph keeps its label on the same column as rows above that
    // carry one.
    const back = {
      label: 'Back',
      value: 'privacy-back',
      ...(privacyOptions?.some((o) => o.icon) ? { icon: { glyph: ' ' } } : {}),
    };
    return [...(privacyOptions ?? []), back];
  }

  const base = menuOptions === undefined ? DEFAULT_MENU : menuOptions;
  // A screen with no menu at all (a fatal state) gains nothing to select.
  if (base === null || !showPrivacy) return base;

  const row = { label: PRIVACY_PANEL_LABEL, value: 'privacy' };
  // Above a trailing Cancel: leaving the wizard stays the last thing offered.
  const insertAt =
    base.at(-1)?.value === 'cancel' ? base.length - 1 : base.length;
  return [...base.slice(0, insertAt), row, ...base.slice(insertAt)];
}

export const IntroScreenLayout = ({
  installDir,
  title = 'PostHog Wizard 🦔',
  showSubtitle = true,
  subtitle,
  body,
  showDetection = true,
  detectionRows,
  children,
  menuOptions,
  menuAlign = 'center',
  showPrivacy = true,
  privacyOptions,
  onSelect,
  programLabel,
  skillId,
  errorView,
}: IntroScreenLayoutProps) => {
  const [showingPrivacy, setShowingPrivacy] = useState(false);

  const resolvedMenuOptions = buildIntroMenu({
    menuOptions,
    showPrivacy,
    showingPrivacy,
    privacyOptions,
  });

  const handleSelect = (value: string) => {
    if (value === 'privacy') return setShowingPrivacy(true);
    if (value === 'privacy-back') return setShowingPrivacy(false);
    onSelect?.(value);
  };

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
          <WizardTitle title={showingPrivacy ? PRIVACY_PANEL_LABEL : title} />

          {showSubtitle && !showingPrivacy && (
            <Box flexDirection="column" alignItems="center" marginTop={1}>
              {subtitle ?? DEFAULT_SUBTITLE}
            </Box>
          )}

          {showingPrivacy ? (
            <Box flexDirection="column" alignItems="center" marginTop={1}>
              {/* The paragraph ends by pointing below, so it only renders
                  where this screen actually put a choice there. */}
              <PrivacyPanel canOptOut={privacyOptions !== undefined} />
            </Box>
          ) : (
            body && (
              <Box flexDirection="column" alignItems="center" marginTop={1}>
                {body}
              </Box>
            )
          )}
        </Box>

        {!showingPrivacy && children}

        {showDetection && !showingPrivacy && (
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

            {detectionRows?.map((row) => (
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

            {programLabel && (
              <Text>
                Program{'  '}
                <Text color="green">{'\u2714'}</Text> {programLabel}
              </Text>
            )}

            {programLabel === 'agent-skill' && skillId && (
              <Text>
                Skill{'     '}
                <Text color="green">{'\u2714'}</Text> {skillId}
              </Text>
            )}
          </Box>
        )}

        <Box width={menuAlign === 'left' ? 64 : 24} marginTop={1}>
          {resolvedMenuOptions && onSelect && (
            <Box
              justifyContent={menuAlign === 'left' ? 'flex-start' : 'center'}
            >
              <PickerMenu
                key={resolvedMenuOptions.map((o) => o.value).join(',')}
                options={resolvedMenuOptions}
                onSelect={(value) => {
                  const choice = Array.isArray(value) ? value[0] : value;
                  handleSelect(choice);
                }}
              />
            </Box>
          )}
        </Box>
      </Box>
    </>
  );
};
