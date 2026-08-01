/**
 * YABUZ OIL & GAS — Staff roles (shared frontend ↔ backend)
 * SUPER_ADMIN: developer-level, everything incl. system settings
 * ADMIN:       full operational control, manages managers, customizes permissions & workflows
 * MANAGER:     runs day-to-day operations, manages sales staff, reviews approvals
 * SALES:       front-line sales staff; sales/payments go through approval workflow
 */
export const USER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Who can manage whom (hierarchy). */
export const MANAGEABLE_ROLES: Record<UserRole, UserRole[]> = {
  SUPER_ADMIN: ["ADMIN", "MANAGER", "SALES"],
  ADMIN: ["MANAGER", "SALES"],
  MANAGER: ["SALES"],
  SALES: [],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  SALES: "Sales",
};
