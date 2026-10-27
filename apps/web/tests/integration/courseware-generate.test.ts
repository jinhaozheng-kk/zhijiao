import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

// 质量门（server/lib/courseware-review.ts）会拦过短/无解答/无答案的课件，
// 集成测试的 mock 输出必须是一份「可直接进课堂」的完整课件。
// 注意：内容必须内联在 vi.mock 工厂里（vi.mock 会被提升，不能在工厂外引用模块级 const）。
vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({
  async generateLessonPlan() {
    const sections = [
      {
        type: "INTRO",
        title: "课堂导入",
        contentMd:
          "（约 5 分钟）\n\n汽车匀速行驶的情境：路程与时间满足 $s=60t$。请思考 $s$ 与 $t$ 的关系，并猜一猜图象的形状。今天学习一次函数 $y=kx+b$ 的定义、图象与 $k$、$b$ 的意义。",
      },
      {
        type: "EXPLANATION",
        title: "讲解结构",
        contentMd:
          "（约 15 分钟）\n\n### 一、定义\n\n形如 $y=kx+b$（$k\\neq 0$）的函数叫一次函数。\n\n### 二、图象\n\n图象是一条直线；$k>0$ 时 $y$ 随 $x$ 增大而增大，$k<0$ 时减小。\n\n### 三、b 的意义\n\n令 $x=0$ 得 $y=b$，所以直线过 $(0,b)$。教师追问：$b$ 为什么只影响与 $y$ 轴的交点？预设回答：因为 $b$ 只改变 $x=0$ 时的函数值。\n\n### 四、板书要点\n\n定义、$k$ 定方向与陡缓、$b$ 定交点、画图三步：列表、描点、连线。",
      },
      {
        type: "EXAMPLE",
        title: "例题",
        contentMd:
          "（约 12 分钟）\n\n**例 1** 已知 $y=2x-3$，判断增减性并求与坐标轴的交点。\n\n思路分析：由 $k$ 的符号判断增减性，令 $x=0$、$y=0$ 求交点。\n\n分步解答：\n1. $k=2>0$，所以 $y$ 随 $x$ 增大而增大；\n2. 令 $x=0$ 得 $y=-3$，交点为 $(0,-3)$；\n3. 令 $y=0$ 得 $x=\\dfrac{3}{2}$，交点为 $(\\dfrac{3}{2},0)$。\n\n方法总结：判断增减性看 $k$，求截距令 $x=0$。",
      },
      {
        type: "PITFALL",
        title: "易错点",
        contentMd:
          "（约 6 分钟）\n\n**易错 1** 把 $b$ 当作斜率。错因：混淆 $k$ 与 $b$ 的作用。正确做法：$k$ 决定陡缓与方向，$b$ 只决定与 $y$ 轴交点。\n\n**易错 2** 忽略 $k\\neq 0$。错因：只看到一次式形式。正确做法：自变量次数为 1 且系数不为 0。\n\n**易错 3** 增减性方向记反。错因：$k$ 的正负与增减性对应记混。正确做法：代入两点验证。",
      },
      {
        type: "EXERCISE",
        title: "课堂练习",
        contentMd:
          "（约 7 分钟）\n\n1. （基础）说明 $y=-4x+7$ 的增减性并求与 $y$ 轴交点。\n2. （基础）求过 $(2,6)$ 且与 $y=3x-2$ 平行的一次函数。\n3. （提高）已知图象过第一、二、四象限，判断 $k$、$b$ 的符号。\n\n### 参考答案\n\n1. $k=-4<0$，$y$ 随 $x$ 增大而减小；交点为 $(0,7)$。\n2. 平行则 $k=3$，代入得 $b=0$，即 $y=3x$。\n3. 过第二象限知 $b>0$，向右下倾斜知 $k<0$。",
      },
    ];
    return { title: "课件", modelCallId: "mc1", sections };
  },
}) }));
const { appRouter } = await import("@/server/routers/_root");

async function seedTeacher(balance: number) {
  const u = await prisma.user.create({ data: { persona: "TEACHER" } });
  await prisma.wallet.create({ data: { userId: u.id, balance } });
  const subject = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
  const kp = await prisma.knowledgePoint.upsert({
    where: { subjectId_code: { subjectId: subject.id, code: "math-g8-linear-eq-solve" } },
    create: { subjectId: subject.id, code: "math-g8-linear-eq-solve", name: "一次方程求解" },
    update: {},
  });
  return { id: u.id, subjectId: subject.id, kpId: kp.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("courseware.generate", () => {
  it("教师生成：落 Courseware + 5 段、扣 3", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const r = await caller.courseware.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", clientRequestId: crypto.randomUUID() });
    expect(await prisma.coursewareSection.count({ where: { coursewareId: r.coursewareId } })).toBe(5);
    const w = await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } });
    expect(w.balance).toBe(97);
  });

  it("非教师：扣费前 FORBIDDEN、不写 DEBIT", async () => {
    const t = await seedTeacher(100);
    const student = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(student.id));
    await expect(caller.courseware.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", clientRequestId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.creditLedger.count({ where: { wallet: { userId: student.id }, kind: "DEBIT" } })).toBe(0);
  });

  it("kpIds 不属于 subject：写 DEBIT 后补偿（净零）、不落 Courseware", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    await expect(caller.courseware.generate({ subjectId: t.subjectId, kpIds: ["clxnonexistentkp00000000"], gradeLevel: "G8", clientRequestId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.courseware.count({ where: { teacherUserId: t.id } })).toBe(0);
    expect((await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } })).balance).toBe(100);
  });

  it("updateSection 改内容；markReady；跨教师 NOT_FOUND", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const r = await caller.courseware.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", clientRequestId: crypto.randomUUID() });
    const sec = await prisma.coursewareSection.findFirstOrThrow({ where: { coursewareId: r.coursewareId, type: "INTRO" } });
    await caller.courseware.updateSection({ coursewareId: r.coursewareId, sectionId: sec.id, contentMd: "改后的导入" });
    expect((await prisma.coursewareSection.findUniqueOrThrow({ where: { id: sec.id } })).contentMd).toBe("改后的导入");
    await caller.courseware.markReady({ coursewareId: r.coursewareId });
    expect((await prisma.courseware.findUniqueOrThrow({ where: { id: r.coursewareId } })).status).toBe("READY");
    const other = await seedTeacher(100);
    await expect(appRouter.createCaller(makeCtx(other.id, { persona: "TEACHER" })).courseware.markReady({ coursewareId: r.coursewareId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
