import type { PrismaClient } from "@prisma/client";
import { Prisma, ModelCallStatus } from "@prisma/client";
import type { AdapterRequest, AdapterResponse } from "./adapters/types.js";

export interface AuditWriteInput {
  taskKind: string;
  promptTemplateId: string | null;
  request: AdapterRequest;
  response: AdapterResponse | null;
  latencyMs: number;
  status: ModelCallStatus;
  errorMessage: string | null;
  userId: string | null;
}

export async function writeAudit(prisma: PrismaClient, input: AuditWriteInput): Promise<string> {
  const row = await prisma.modelCall.create({
    data: {
      taskKind:         input.taskKind,
      promptTemplateId: input.promptTemplateId,
      model:            input.response?.model ?? input.request.model,
      requestJson:      input.request as unknown as Prisma.InputJsonValue,
      responseJson:     input.response
        ? (input.response as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      latencyMs:        input.latencyMs,
      tokensIn:         input.response?.tokensIn,
      tokensOut:        input.response?.tokensOut,
      status:           input.status,
      errorMessage:     input.errorMessage,
      userId:           input.userId,
    },
  });
  return row.id;
}
