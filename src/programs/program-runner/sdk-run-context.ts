/** What the runner and the TUI's spell book both read from a session to pick a program's SDK skills and scope. */
import type { Integration } from '@shared/constants';
import { POSTHOG_SDK_SPECS } from '@shared/posthog-sdks';
import type { MatchKeys } from '@shared/skill-resolution';
import { FRAMEWORK_REGISTRY } from '@services/frameworks';
import { getTraits, toMatchKeys } from '@services/project-traits';
import type {
  ProgramConfig,
  ProgramRunStep,
  ProgramSession,
} from '@programs/program-contract';

type TraitSession = Parameters<typeof getTraits>[0];

const SDK_TRAIT_KEYS = new Set<string>(
  Object.values(POSTHOG_SDK_SPECS).map((spec) => spec.trait),
);

/** The skill match keys of a session; SDK majors count only for a program with `sdkSupport`. */
export function programMatchKeys(
  session: TraitSession,
  program: Pick<ProgramConfig, 'sdkSupport'>,
): MatchKeys {
  const keys = toMatchKeys(getTraits(session));
  if (program.sdkSupport) return keys;
  const filtered: Record<string, readonly string[] | undefined> = {};
  for (const [key, value] of Object.entries(keys)) {
    if (!SDK_TRAIT_KEYS.has(key)) filtered[key] = value;
  }
  return filtered;
}

/** The SDK skill family the session's framework defaults to on a greenfield project. */
export function frameworkSdkSkillFamily(
  session: Pick<ProgramSession, 'frameworkConfig' | 'integration' | 'skillId'>,
): string | undefined {
  if (session.frameworkConfig?.metadata.sdkSkillFamily) {
    return session.frameworkConfig.metadata.sdkSkillFamily;
  }
  const framework = session.integration ?? session.skillId;
  return framework
    ? FRAMEWORK_REGISTRY[framework as Integration]?.metadata.sdkSkillFamily
    : undefined;
}

/** The program's own (not composed) run step: the one a host's run runs in the program's name. */
function ownRunStep(
  config: Pick<ProgramConfig, 'runSteps'> | undefined,
): ProgramRunStep | undefined {
  return Object.values(config?.runSteps ?? {})
    .filter((step) => !step.runProgramId)
    .at(-1);
}

/** Whether the program's own run is scoped to a directory picked after detection. */
export function hasOwnTargetDir(
  config: Pick<ProgramConfig, 'runSteps'> | undefined,
): boolean {
  return Boolean(ownRunStep(config)?.targetDir);
}

/** The directory the program's own run works in, when it picks one. */
export function ownTargetDir(
  config: Pick<ProgramConfig, 'runSteps'> | undefined,
  session: ProgramSession,
): string | undefined {
  return ownRunStep(config)?.targetDir?.(session);
}
