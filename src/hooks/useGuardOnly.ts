import { useAuth } from "@/contexts/AuthContext";

/** True when the user is a gate guard without office rights: use GuardShell instead of ERPLayout. */
export const useGuardOnly = () => {
  const { roles, hasModulePermission } = useAuth();
  return roles.some((r) => r.role === "gate_security") && !hasModulePermission("gate_pass", "create");
};
