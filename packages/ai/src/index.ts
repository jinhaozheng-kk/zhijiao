export { AiRouter, ComplianceRejectedError, type RouterOptions } from "./router.js";
export { PromptVersionConflictError } from "./registry.js";
export { DashScopeAdapter } from "./adapters/dashscope.js";
export { MockAdapter } from "./adapters/mock.js";
export type { ModelAdapter, AdapterRequest, AdapterResponse } from "./adapters/types.js";
export { TASK_MODEL_MAP, type TaskKind } from "./tasks.js";
export {
  TutoringInputSchema,
  TutoringOutputSchema,
  type TutoringInput,
  type TutoringOutput,
  // Plan 4:
  ErrorRootCauseEnum,
  ErrorAnalysisInputSchema,
  ErrorAnalysisOutputSchema,
  type ErrorRootCauseValue,
  type ErrorAnalysisInput,
  type ErrorAnalysisOutput,
  VariantLevelEnum,
  VariantAnchorKpSchema,
  VariantItemSchema,
  VariantGenerationInputSchema,
  VariantGenerationOutputSchema,
  AssignmentTierLevelSchema,
  AssignmentQuestionTypeSchema,
  AssignmentQuestionGenerationInputSchema,
  AssignmentQuestionGenerationItemSchema,
  AssignmentQuestionGenerationOutputSchema,
  type VariantLevelValue,
  type VariantAnchorKp,
  type VariantItemValue,
  type VariantGenerationInput,
  type VariantGenerationOutput,
  type AssignmentTierLevel,
  type AssignmentQuestionType,
  type AssignmentQuestionGenerationInput,
  type AssignmentQuestionGenerationItem,
  type AssignmentQuestionGenerationOutput,
  // Plan 11:
  LearningAdviceInputSchema,
  LearningAdviceOutputSchema,
  type LearningAdviceInput,
  type LearningAdviceOutput,
} from "./schemas.js";
