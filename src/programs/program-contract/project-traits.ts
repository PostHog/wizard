/** The project-trait vocabulary programs and services share; `@services/project-traits` produces the values. */

export type TraitName = 'framework' | 'callsLlmApi';

/** Where a trait's value came from: static detection, or the person (the intro picker or `--integration`). */
export type TraitSource = 'static' | 'user';

/** A predicate trait's value is `yes` or `no`; the framework's is its integration id. */
export type Trait = {
  value: string;
  source: TraitSource;
};

export type ProjectTraits = Partial<Record<TraitName, Trait>>;
