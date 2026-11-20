/** The Decisions judgment service: a program's questions about the code, and Decisions as a trait source. */
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
  decisionsMode,
  decisionsTransport,
  getDecisions,
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
  integrationFromChoice,
  NO_FRAMEWORK,
  routeIntegration,
} from './framework';
export { QUESTIONS, type QuestionKey } from './questions';
export {
  decisionTraitWrites,
  rankProjectsWithDecisions,
  runDecisionsSource,
  type DecisionsSourceContext,
} from './traits';
export { choice, defineQuestions, predicate } from './builders';
export {
  compareProjectReports,
  detectProjectsWithDecisions,
  judgeProjects,
  type JudgedProjects,
} from './projects';
