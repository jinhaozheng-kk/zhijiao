import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isErrorBookPartialUniqueP2002 } from "@/server/lib/error-book";

function p2002(target: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

describe("error-book lib", () => {
  it("recognizes partial unique P2002 when Prisma reports the index name", () => {
    expect(
      isErrorBookPartialUniqueP2002(p2002("error_book_entries_user_question_active_idx")),
    ).toBe(true);
  });

  it("recognizes partial unique P2002 when Prisma reports user_id/question_id fields", () => {
    expect(isErrorBookPartialUniqueP2002(p2002(["user_id", "question_id"]))).toBe(true);
  });

  it("does not treat unrelated P2002 targets as error-book active-entry races", () => {
    expect(isErrorBookPartialUniqueP2002(p2002("credit_ledger_idem_key_key"))).toBe(false);
  });
});
