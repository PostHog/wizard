/** The Decisions judgment service: programs declare questions, the run asks them once. */
export type {
  DecisionAnswer,
  DecisionQuestionSpec,
  DecisionsMode,
  DecisionsResult,
  ProgramDecisions,
} from './types';
export {
  actionableAnswer,
  actionableProbability,
  DECISIONS_KEY,
  decisionsTransport,
  getDecisions,
  getDecisionsMode,
  runProgramDecisions,
  summarizeAnswers,
} from './service';
export {
  askDecisions,
  DECISIONS_MAX_QUESTIONS_PER_CALL,
  toApiQuestion,
} from './ask';
export { renderDecisionInput, renderFileTree } from './input';
export {
  collectDecisionsScan,
  getDecisionsScan,
  type DecisionsScan,
} from './scan';
export {
  FRAMEWORK_QUESTION,
  IS_MONOREPO_QUESTION,
  integrationFromChoice,
  routeIntegration,
} from './framework';
export { detectProjectsWithDecisions, judgeProjects } from './projects';
