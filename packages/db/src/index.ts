import { PrismaClient } from "@prisma/client";

// Singleton pattern for Next.js dev hot-reload:
// 不缓存的话，每次模块重新求值会创建新的 PrismaClient，长时间开 dev server 会泄漏连接。
// 用 globalThis 作为模块边界外的稳定句柄；生产环境每个 process 都是全新启动，不走缓存。
const globalForPrisma = globalThis as unknown as { __zhijiaoPrisma?: PrismaClient };

export const prisma = globalForPrisma.__zhijiaoPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__zhijiaoPrisma = prisma;
}

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
