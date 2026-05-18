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

export { Role, GradeLevel, QuestionType, QuestionStatus, ModelCallStatus } from "@prisma/client";
