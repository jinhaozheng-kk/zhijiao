// 全学段 KP 树数据结构 + 纯校验器。零 Prisma 依赖（可在单测直接 import）。
// normalizeAlias 必须与 apps/web/server/lib/kp-reconcile.ts 的 normalizeKpHint 一致：
// trim + 折叠空白 + lowercase。

export type KpNode = {
  code: string; // 学科内唯一，如 "math-jh-alg-linear-solve"
  name: string;
  difficulty?: number; // 仅叶子有意义；容器忽略，叶子默认 3
  aliases?: string[]; // 仅叶子可有；容器带 alias 视为数据错误
  children?: KpNode[];
};

export function normalizeAlias(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function isLeaf(node: KpNode): boolean {
  return !node.children || node.children.length === 0;
}

function walk(nodes: KpNode[], visit: (n: KpNode) => void): void {
  for (const n of nodes) {
    visit(n);
    if (n.children?.length) walk(n.children, visit);
  }
}

// 收集所有叶子上的 (kpCode, normalizedAlias) 对。
export function collectLeafAliases(roots: KpNode[]): Array<{ kpCode: string; alias: string }> {
  const out: Array<{ kpCode: string; alias: string }> = [];
  walk(roots, (n) => {
    if (isLeaf(n) && n.aliases) {
      for (const a of n.aliases) out.push({ kpCode: n.code, alias: normalizeAlias(a) });
    }
  });
  return out;
}

export function flattenLeafCodes(roots: KpNode[]): string[] {
  const out: string[] = [];
  walk(roots, (n) => {
    if (isLeaf(n)) out.push(n.code);
  });
  return out;
}

// seed 入口与单测共用。命中即 throw —— 把"别犯错"变成"犯错即报"。
export function validateKpData(roots: KpNode[]): void {
  const seenCodes = new Set<string>();
  const aliasOwner = new Map<string, string>(); // normalizedAlias → kpCode

  walk(roots, (n) => {
    // 1. code 全局唯一
    if (seenCodes.has(n.code)) {
      throw new Error(`validateKpData: duplicate code "${n.code}"`);
    }
    seenCodes.add(n.code);

    if (!n.aliases || n.aliases.length === 0) return;

    // 3. alias 只挂叶子
    if (!isLeaf(n)) {
      throw new Error(`validateKpData: alias on non-leaf node "${n.code}"`);
    }

    // 2. alias 全局唯一（同 math subject 内，否则 seed upsert 会静默错绑）
    for (const raw of n.aliases) {
      const norm = normalizeAlias(raw);
      const prev = aliasOwner.get(norm);
      if (prev && prev !== n.code) {
        throw new Error(
          `validateKpData: duplicate alias "${norm}" claimed by both "${prev}" and "${n.code}"`,
        );
      }
      aliasOwner.set(norm, n.code);
    }
  });
}
