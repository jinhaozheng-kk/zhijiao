import type { KpNode } from "./types.js";
import { juniorMath } from "./junior-math.js";
import { primaryMath } from "./primary-math.js";
import { seniorMath } from "./senior-math.js";

// 全 math subject 的根集合（三学段）。curriculum / alias seed 共用此真源。
export const mathKpRoots: KpNode[] = [primaryMath, juniorMath, seniorMath];

export type { KpNode };
