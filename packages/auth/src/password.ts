import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const FORMAT = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return [FORMAT, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) return false;

  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== FORMAT) return false;
  const [, saltPart, keyPart] = parts as [string, string, string];

  try {
    const salt = Buffer.from(saltPart, "base64url");
    const expected = Buffer.from(keyPart, "base64url");
    if (expected.length !== KEY_LENGTH) return false;

    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
