import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// 类型导出（让消费者不必直接依赖 @prisma/client）
export type {
  User,
  UserRole,
  Subject,
  KnowledgePoint,
  Question,
  QuestionAnswer,
  QuestionKPLink,
  PromptTemplate,
  ModelCall,
  Prisma,
} from "@prisma/client";

export { Role, QuestionType, QuestionStatus, ModelCallStatus } from "@prisma/client";

// GradeLevel enum is defined in schema but not yet used in any model field;
// export it from the schema directly so consumers have access to the values.
export enum GradeLevel {
  G5 = "G5",
  G6 = "G6",
  G7 = "G7",
  G8 = "G8",
  G9 = "G9",
  G10 = "G10",
  G11 = "G11",
  G12 = "G12",
}
