// 无副作用的 seed 函数 barrel（区别于 prisma/seed/index.ts —— 后者 import 即跑 main()）。
// 供测试 / 脚本灌真 curriculum 树用，经 package.json exports "./seed" 暴露。
export { seedCurriculum } from "../prisma/seed/0_curriculum.js";
export { seedKpAliases } from "../prisma/seed/3_kp_aliases.js";
export { mathKpRoots } from "../prisma/seed/kp-data/index.js";
export type { KpNode } from "../prisma/seed/kp-data/types.js";
