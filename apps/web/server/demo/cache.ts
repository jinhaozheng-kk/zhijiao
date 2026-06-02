import "server-only";
import { redis } from "@/lib/redis";
import { classCacheKey, profileCacheKey } from "@/server/lib/learning-cache";
import { DEMO_IDS } from "./config";

const WINDOWS = ["D30", "D90", "ALL"] as const;
const DEMO_STUDENT_IDS = [
  DEMO_IDS.studentUserId,
  DEMO_IDS.stableStudentUserId,
  DEMO_IDS.consolidatingStudentUserId,
] as const;

export async function clearDemoAnalyticsCache(): Promise<void> {
  const keys = [
    ...DEMO_STUDENT_IDS.flatMap((userId) =>
      WINDOWS.map((window) => profileCacheKey(userId, window)),
    ),
    ...WINDOWS.map((window) => classCacheKey(DEMO_IDS.classroomId, window)),
  ];
  if (keys.length > 0) await redis.del(...keys);
}
