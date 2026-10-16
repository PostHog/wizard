/**
 * The Decisions judgment service. Outside this folder, import it only with a
 * dynamic `import()` behind `!IS_PRODUCTION_BUILD`, so production builds drop
 * it, and type-only otherwise. `pnpm check:decisions-bundle` verifies that.
 */
export type {
  DecisionAnswer,
  DecisionQuestionSpec,
  DecisionsMode,
  DecisionsResult,
  DecisionsTransport,
} from './types';
export {
  actionableAnswer,
  actionableProbability,
  DECISIONS_KEY,
  decisionsTransport,
  getDecisions,
  getDecisionsMode,
  questionFacts,
  runDecisionSpecs,
  runProgramDecisions,
  summarizeAnswers,
} from './service';
export { askDecisions, chunk, DECISIONS_MAX_QUESTIONS_PER_CALL } from './ask';
export {
  DECISIONS_MODEL,
  previewRequests,
  toClassifierQuestion,
} from './classifier';
export {
  renderDecisionInput,
  renderDecisionState,
  renderFileTree,
  type DecisionState,
} from './input';
export {
  collectDecisionsScan,
  getDecisionsScan,
  type DecisionsScan,
} from './scan';
export {
  integrationFromChoice,
  NO_FRAMEWORK,
  routeIntegration,
} from './framework';
export { QUESTIONS, type QuestionKey } from './questions';
export { choice, defineQuestions, predicate } from './builders';
export {
  compareProjectReports,
  detectProjectsWithDecisions,
  judgeProjects,
  type JudgedProjects,
} from './projects';
