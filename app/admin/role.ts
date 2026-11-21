"use client";

import { createContext, useContext } from "react";

// The logged-in person's access in the admin panel. The server checks every action too; this only
// hides buttons that would be refused. Outside the admin page (staff mode on the booking grid) it
// defaults to day-to-day access.
export type AdminRole = "owner" | "manager" | "staff" | "scholar";
export const RoleContext = createContext<AdminRole>("staff");
/** The owner and managers: settings, deleting, imports and the rest (not Staff or Scholars). */
export const canManageRole = (role: AdminRole) => role === "owner" || role === "manager";
export const useCanManage = () => canManageRole(useContext(RoleContext));
