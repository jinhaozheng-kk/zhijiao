export type Role = "OPS" | "ADMIN";

export type Permission =
  | "TUTOR_ASK"
  | "PAPER_GEN"
  | "LESSON_PLAN_GEN"
  | "PPT_GEN"
  | "ERROR_BOOK_VIEW_OWN"
  | "OPS_PUBLISH_FORECAST"
  | "OPS_CURATE_CONTENT"
  | "OPS_ADJUST_CREDIT"
  | "ADMIN_MANAGE_USERS"
  | "ADMIN_MANAGE_MODELS"
  | "ADMIN_VIEW_AUDIT";

export const DEFAULT_LOGGED_IN_PERMS: Permission[] = [
  "TUTOR_ASK",
  "PAPER_GEN",
  "LESSON_PLAN_GEN",
  "PPT_GEN",
  "ERROR_BOOK_VIEW_OWN",
];

const OPS_PERMS: Permission[] = ["OPS_PUBLISH_FORECAST", "OPS_CURATE_CONTENT", "OPS_ADJUST_CREDIT"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OPS: OPS_PERMS,
  ADMIN: [...OPS_PERMS, "ADMIN_MANAGE_USERS", "ADMIN_MANAGE_MODELS", "ADMIN_VIEW_AUDIT"],
};

export function hasPermission(roles: Role[], perm: Permission): boolean {
  if (DEFAULT_LOGGED_IN_PERMS.includes(perm)) return true;
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(perm));
}
