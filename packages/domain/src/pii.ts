// 通用 PII 检测/脱敏（手机号 + 身份证）。纯函数、零依赖。
// 全占位掩码；只返类型计数，绝不返回命中的原始值（防 PII 流进日志/审计）。

const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const ID_RE = /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g;

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK_CODES = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];

function isValidIdChecksum(id: string): boolean {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(id[i]) * ID_WEIGHTS[i]!;
  return ID_CHECK_CODES[sum % 11] === id[17]!.toUpperCase();
}

export interface PiiHits {
  phone: number;
  idCard: number;
}

export function redactPii(text: string): { redacted: string; hits: PiiHits } {
  if (typeof text !== "string" || text.length === 0) {
    return { redacted: text, hits: { phone: 0, idCard: 0 } };
  }
  let idCard = 0;
  let redacted = text.replace(ID_RE, (m) => {
    if (isValidIdChecksum(m)) {
      idCard++;
      return "[身份证号]";
    }
    return m;
  });
  let phone = 0;
  redacted = redacted.replace(PHONE_RE, () => {
    phone++;
    return "[手机号]";
  });
  return { redacted, hits: { phone, idCard } };
}

export function scanPii(text: string): PiiHits {
  return redactPii(text).hits;
}
