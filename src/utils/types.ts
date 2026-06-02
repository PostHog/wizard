export type CloudRegion = 'us' | 'eu';

export type AIModel =
  | 'gpt-5-mini'
  | 'o4-mini'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro';

export type FileChange = {
  filePath: string;
  oldContent?: string;
  newContent: string;
};

export type WizardRunOptions = {
  installDir: string;
  ci: boolean;
  cloudRegion?: CloudRegion;

  debug: boolean;
  default: boolean;
  menu: boolean;
  forceInstall: boolean;
  benchmark: boolean;
  yaraReport: boolean;

  signup: boolean;
  email?: string;
  apiKey?: string;
  projectId?: number;

  localMcp: boolean;
};
