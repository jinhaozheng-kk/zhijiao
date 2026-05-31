// Plan 14b: DSAR service. 注意:本文件【不】import "server-only" —— 它被 tsx CLI
// (dsar:list/fulfill/reject)直接 import,server-only 的 default 导出会 throw(见
// kp-reconcile.ts / pii-governance.ts 同款先例)。server-only 只加在 routers/dsar.ts。

import { type Prisma, type PrismaClient } from "@prisma/client";
import { deactivateUser, previewDeactivateUser } from "./pii-governance.js";

const SLA_WORKING_DAYS = 15;
const SLA_CALENDAR_CAP_DAYS = 30;

// 前进 n 个工作日(跳周六周日,法定节假日忽略)。UTC 维度;n=0 返回副本。
export function addWorkingDays(date: Date, n: number): Date {
  const out = new Date(date.getTime());
  let added = 0;
  while (added < n) {
    out.setUTCDate(out.getUTCDate() + 1);
    const day = out.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return out;
}

// SLA 截止:15 工作日,但永不超过 +30 自然日(防长假把工作日推过 PIPL ~30 日预期)。
export function dueAtFor(requestedAt: Date): Date {
  const working = addWorkingDays(requestedAt, SLA_WORKING_DAYS);
  const cap = new Date(requestedAt.getTime() + SLA_CALENDAR_CAP_DAYS * 86_400_000);
  return working.getTime() < cap.getTime() ? working : cap;
}

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface DsarRequestView {
  id: string;
  type: "EXPORT" | "DELETION";
  status: "AWAITING_GUARDIAN" | "PENDING" | "COMPLETED" | "REJECTED" | "CANCELED";
  isMinor: boolean;
  requestedAt: Date;
  dueAt: Date;
  resolvedAt: Date | null;
  rejectionReason: string | null; // 仅 REJECTED 回显 resolutionNote;其它为 null
}

function toView(r: {
  id: string; type: string; status: string; isMinor: boolean;
  requestedAt: Date; dueAt: Date; resolvedAt: Date | null; resolutionNote: string | null;
}): DsarRequestView {
  return {
    id: r.id,
    type: r.type as DsarRequestView["type"],
    status: r.status as DsarRequestView["status"],
    isMinor: r.isMinor,
    requestedAt: r.requestedAt,
    dueAt: r.dueAt,
    resolvedAt: r.resolvedAt,
    rejectionReason: r.status === "REJECTED" ? r.resolutionNote : null,
  };
}

const OPEN_DELETION = ["AWAITING_GUARDIAN", "PENDING"] as const;

export async function recordExportRequest(
  db: DbClient,
  args: { userId: string; isMinor: boolean; now?: Date },
): Promise<{ id: string }> {
  const now = args.now ?? new Date();
  return db.dsarRequest.create({
    data: { userId: args.userId, type: "EXPORT", status: "COMPLETED", isMinor: args.isMinor, requestedAt: now, dueAt: now, resolvedAt: now, resolvedByRef: "self" },
    select: { id: true },
  });
}

export class NeedsGuardianError extends Error {}

export async function createDeletionRequest(
  db: DbClient,
  args: { userId: string; needsGuardian: boolean; hasActiveGuardian: boolean; reason?: string | null; now?: Date },
): Promise<{ request: DsarRequestView; alreadyOpen: boolean }> {
  const existing = await db.dsarRequest.findFirst({
    where: { userId: args.userId, type: "DELETION", status: { in: [...OPEN_DELETION] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { request: toView(existing), alreadyOpen: true };

  if (args.needsGuardian && !args.hasActiveGuardian) throw new NeedsGuardianError("guardian required");

  const now = args.now ?? new Date();
  const created = await db.dsarRequest.create({
    data: {
      userId: args.userId,
      type: "DELETION",
      status: args.needsGuardian ? "AWAITING_GUARDIAN" : "PENDING",
      isMinor: args.needsGuardian,
      reason: args.reason ?? null,
      requestedAt: now,
      dueAt: dueAtFor(now),
    },
  });
  return { request: toView(created), alreadyOpen: false };
}

export async function approveChildDeletion(
  db: DbClient,
  args: { childUserId: string; guardianUserId: string; now?: Date },
): Promise<DsarRequestView | null> {
  const awaiting = await db.dsarRequest.findFirst({
    where: { userId: args.childUserId, type: "DELETION", status: "AWAITING_GUARDIAN" },
    orderBy: { createdAt: "desc" },
  });
  if (!awaiting) return null;
  const updated = await db.dsarRequest.update({
    where: { id: awaiting.id },
    data: { status: "PENDING", guardianApprovedByUserId: args.guardianUserId, guardianApprovedAt: args.now ?? new Date() },
  });
  return toView(updated);
}

export async function cancelDeletionRequest(
  db: DbClient,
  args: { userId: string; now?: Date },
): Promise<DsarRequestView | null> {
  const open = await db.dsarRequest.findFirst({
    where: { userId: args.userId, type: "DELETION", status: { in: [...OPEN_DELETION] } },
    orderBy: { createdAt: "desc" },
  });
  if (!open) return null;
  const updated = await db.dsarRequest.update({
    where: { id: open.id },
    data: { status: "CANCELED", resolvedAt: args.now ?? new Date(), resolvedByRef: "self" },
  });
  return toView(updated);
}

export async function listOwnRequests(db: DbClient, userId: string): Promise<DsarRequestView[]> {
  const rows = await db.dsarRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(toView);
}

export async function listPendingChildApprovals(
  db: DbClient,
  guardianUserId: string,
): Promise<Array<{ childUserId: string; request: DsarRequestView }>> {
  const links = await db.familyLink.findMany({
    where: { parentUserId: guardianUserId, status: "ACTIVE" },
    select: { studentUserId: true },
  });
  const childIds = links.map((l) => l.studentUserId);
  if (childIds.length === 0) return [];
  const rows = await db.dsarRequest.findMany({
    where: { userId: { in: childIds }, type: "DELETION", status: "AWAITING_GUARDIAN" },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ childUserId: r.userId, request: toView(r) }));
}

export interface OpsDsarRow {
  id: string; userId: string; type: string; status: string;
  isMinor: boolean; guardianApproved: boolean; requestedAt: Date; dueAt: Date; overdue: boolean;
}

export async function listForOps(
  prisma: PrismaClient,
  args: { status?: "pending" | "all"; type?: "export" | "deletion"; overdueOnly?: boolean; now?: Date },
): Promise<OpsDsarRow[]> {
  const now = args.now ?? new Date();
  const where: Prisma.DsarRequestWhereInput = {};
  if ((args.status ?? "pending") === "pending") where.status = { in: ["AWAITING_GUARDIAN", "PENDING"] };
  if (args.type) where.type = args.type === "export" ? "EXPORT" : "DELETION";
  if (args.overdueOnly) where.dueAt = { lt: now };
  const rows = await prisma.dsarRequest.findMany({ where, orderBy: { dueAt: "asc" } });
  return rows.map((r) => ({
    id: r.id, userId: r.userId, type: r.type, status: r.status, isMinor: r.isMinor,
    guardianApproved: r.guardianApprovedByUserId != null,
    requestedAt: r.requestedAt, dueAt: r.dueAt,
    overdue: (r.status === "PENDING" || r.status === "AWAITING_GUARDIAN") && r.dueAt < now,
  }));
}

export class DsarFulfillError extends Error {}

export async function fulfillDeletion(
  prisma: PrismaClient,
  args: { requestId: string; operatorId: string | null; initiatorRef: string; dryRun?: boolean },
) {
  const req = await prisma.dsarRequest.findUnique({ where: { id: args.requestId } });
  if (!req) throw new DsarFulfillError(`DSAR request not found: ${args.requestId}`);
  if (req.type !== "DELETION") throw new DsarFulfillError(`not a DELETION request`);
  if (req.status !== "PENDING") throw new DsarFulfillError(`request not PENDING (is ${req.status})`);

  const liveUser = await prisma.user.findUnique({ where: { id: req.userId }, select: { isMinor: true } });
  const isMinor = req.isMinor || liveUser?.isMinor === true;
  if (isMinor && req.guardianApprovedByUserId == null) {
    throw new DsarFulfillError(`minor account requires in-app guardian approval before fulfilling ${args.requestId}`);
  }

  if (args.dryRun) {
    const preview = await previewDeactivateUser(prisma, req.userId);
    return { dryRun: true, preview, requestId: req.id };
  }

  const result = await deactivateUser(prisma, {
    userId: req.userId, operatorId: args.operatorId, initiatorRef: args.initiatorRef, reason: "DSAR_DELETION_REQUEST",
  });
  // deactivateUser 的事务内部已将 open DELETION 请求翻转为 COMPLETED（见 pii-governance.ts
  // dsarRequest.updateMany status→COMPLETED）。此处验证最终态正确即可；
  // 若已被 deactivateUser 并发完成则属正常路径，不视为竞态错误。
  const after = await prisma.dsarRequest.findUnique({ where: { id: req.id }, select: { status: true } });
  if (after?.status !== "COMPLETED") {
    throw new DsarFulfillError(`request was concurrently resolved to unexpected status: ${after?.status ?? "not found"}`);
  }
  return { dryRun: false, deactivate: result, requestId: req.id };
}

export async function rejectDeletion(
  prisma: PrismaClient,
  args: { requestId: string; note: string; initiatorRef: string },
): Promise<OpsDsarRow> {
  const req = await prisma.dsarRequest.findUnique({ where: { id: args.requestId } });
  if (!req) throw new DsarFulfillError(`DSAR request not found`);
  if (req.status !== "PENDING" && req.status !== "AWAITING_GUARDIAN") throw new DsarFulfillError(`request not open (is ${req.status})`);
  const updated = await prisma.dsarRequest.update({
    where: { id: req.id },
    data: { status: "REJECTED", resolvedAt: new Date(), resolvedByRef: args.initiatorRef, resolutionNote: args.note },
  });
  return {
    id: updated.id, userId: updated.userId, type: updated.type, status: updated.status, isMinor: updated.isMinor,
    guardianApproved: updated.guardianApprovedByUserId != null, requestedAt: updated.requestedAt, dueAt: updated.dueAt, overdue: false,
  };
}
