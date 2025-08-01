export type PostHogProjectData = Record<string, unknown>;

export type PreselectedProject = {
  project: PostHogProjectData;
  authToken: string;
};

export type WizardOptions = {
  /**
   * Whether to enable debug mode.
   */
  debug: boolean;

  /**
   * Whether to force install the SDK package to continue with the installation in case
   * any package manager checks are failing (e.g. peer dependency versions).
   *
   * Use with caution and only if you know what you're doing.
   *
   * Does not apply to all wizard flows (currently NPM only)
   */
  forceInstall: boolean;

  /**
   * The directory to run the wizard in.
   */
  installDir: string;

  /**
   * The cloud region to use.
   */
  cloudRegion?: CloudRegion;

  /**
   * Whether to select the default option for all questions automatically.
   */
  default: boolean;

  /**
   * Whether to create a new PostHog account during setup.
   */
  signup: boolean;
};

export interface Feature {
  id: string;
  prompt: string;
  enabledHint?: string;
  disabledHint?: string;
}

export type FileChange = {
  filePath: string;
  oldContent?: string;
  newContent: string;
};

export type CloudRegion = 'us' | 'eu';

export type AIModel = 'o4-mini' | 'gemini-2.5-flash' | 'gemini-2.5-pro';
