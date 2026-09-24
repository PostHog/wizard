import type { ProgramInput } from './run-program';

/** Fields that carry functions or class instances; everything else is data. */
const KEPT_BY_REFERENCE = [
  'credentials',
  'run',
  'program',
  'hooks',
  'seedTasks',
] as const satisfies readonly (keyof ProgramInput)[];

/**
 * Copy a host's program input when runProgram receives it, so a later host
 * write cannot reach the run or the completion hooks built from it. Data is
 * cloned; functions, and the objects that carry them, stay by reference.
 */
export function snapshotProgramInput(input: ProgramInput): ProgramInput {
  const data: Partial<ProgramInput> = { ...input };
  for (const key of KEPT_BY_REFERENCE) delete data[key];
  return { ...input, ...structuredClone(data) };
}
