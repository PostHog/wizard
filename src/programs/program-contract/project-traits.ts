/** The project-trait vocabulary programs and services share; `@services/project-traits` produces the values. */

export type TraitName = 'framework' | 'callsLlmApi';

/** A predicate trait's value is `yes` or `no`; the framework's is its integration id. */
export type Trait = {
  value: string;
  source: 'static';
};

export type ProjectTraits = Partial<Record<TraitName, Trait>>;
