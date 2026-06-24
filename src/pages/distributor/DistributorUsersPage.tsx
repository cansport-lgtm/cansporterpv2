import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UserCog, KeyRound, Trash2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";

type AppUser = Database["public"]["Tables"]["app_users"]["Row"];
type DistributorRole = "distributor_sales" | "distributor_manager" | "distributor_admin";

interface DistributorUser extends AppUser {
  roles: DistributorRole[];
}

const ROLE_OPTIONS: { value: DistributorRole; label: string }[] = [
  { value: "distributor_sales", label: "Sales (create & submit orders)" },
  { value: "distributor_manager", label: "Manager (approve/reject/edit + dispatch)" },
  { value: "distributor_admin", label: "Admin (manage users)" },
];

const ROLE_LABEL: Record<DistributorRole, string> = {
  distributor_sales: "Sales",
  distributor_manager: "Manager",
  distributor_admin: "Admin",
};

export default function DistributorUsersPage() {
  const queryClient = useQueryClient();
  const { getDistributorScope } = useAuth();
  const { isCompany, distributorId } = getDistributorScope();

  const [selectedDistributor, setSelectedDistributor] = useState<string | null>(distributorId);
  const activeDistributorId = isCompany ? selectedDistributor : distributorId;

  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<DistributorUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DistributorUser | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState({
    user_id: "",
    full_name: "",
    password: "",
    designation: "",
    roles: ["distributor_sales"] as DistributorRole[],
  });

  const toggleRole = (role: DistributorRole, checked: boolean) => {
    setForm((f) => ({
      ...f,
      roles: checked ? [...f.roles, role] : f.roles.filter((r) => r !== role),
    }));
  };

  const { data: distributors = [] } = useQuery({
    queryKey: ["distributors-active"],
    enabled: isCompany,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["distributor_users", activeDistributorId],
    enabled: !!activeDistributorId,
    queryFn: async () => {
      const { data: usersData, error } = await supabase
        .from("app_users")
        .select("*")
        .eq("distributor_id", activeDistributorId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const withRoles = await Promise.all(
        (usersData || []).map(async (u) => {
          const { data: rolesData } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", u.id);
          return {
            ...u,
            roles: (rolesData || [])
              .map((r) => r.role)
              .filter((r): r is DistributorRole =>
                ["distributor_sales", "distributor_manager", "distributor_admin"].includes(r)
              ),
          };
        })
      );
      return withRoles as DistributorUser[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!activeDistributorId) throw new Error("No distributor selected");
      const { data: newId, error } = await supabase.rpc("create_app_user", {
        p_user_id: form.user_id.trim(),
        p_full_name: form.full_name.trim(),
        p_password: form.password,
        p_designation: form.designation.trim() || null,
      });
      if (error) throw error;
      // Link the new user to this distributor (the isolation key).
      const { error: linkError } = await supabase
        .from("app_users")
        .update({ distributor_id: activeDistributorId })
        .eq("id", newId as string);
      if (linkError) throw linkError;
      const { error: roleError } = await supabase
        .from("user_roles")
        .insert(form.roles.map((role) => ({ user_id: newId as string, role })));
      if (roleError) throw roleError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_users", activeDistributorId] });
      toast.success("User created");
      setCreateOpen(false);
      setForm({ user_id: "", full_name: "", password: "", designation: "", roles: ["distributor_sales"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to create user"),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!resetTarget) return;
      const { error } = await supabase.rpc("reset_user_password", {
        p_user_uuid: resetTarget.id,
        p_new_password: newPassword,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password reset");
      setResetTarget(null);
      setNewPassword("");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to reset password"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (u: DistributorUser) => {
      const { error } = await supabase
        .from("app_users")
        .update({ is_active: !u.is_active })
        .eq("id", u.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_users", activeDistributorId] });
      toast.success("User updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to update user"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (u: DistributorUser) => {
      await supabase.from("user_roles").delete().eq("user_id", u.id);
      const { error } = await supabase.from("app_users").delete().eq("id", u.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_users", activeDistributorId] });
      toast.success("User deleted");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to delete user"),
  });

  const handleCreate = () => {
    if (!form.user_id.trim() || !form.full_name.trim() || !form.password) {
      toast.error("User ID, full name and password are required");
      return;
    }
    if (form.roles.length === 0) {
      toast.error("Select at least one role");
      return;
    }
    createMutation.mutate();
  };

  const columns = [
    {
      key: "user_id",
      header: "User ID",
      render: (u: DistributorUser) => (
        <code className="bg-muted px-2 py-1 rounded text-sm font-mono">{u.user_id}</code>
      ),
    },
    { key: "full_name", header: "Full Name" },
    {
      key: "roles",
      header: "Role",
      render: (u: DistributorUser) => (
        <div className="flex gap-1 flex-wrap">
          {u.roles.map((r) => (
            <Badge key={r} variant="outline">{ROLE_LABEL[r]}</Badge>
          ))}
        </div>
      ),
    },
    {
      key: "is_active",
      header: "Status",
      render: (u: DistributorUser) => <StatusBadge status={u.is_active ? "approved" : "rejected"} />,
    },
    {
      key: "last_login",
      header: "Last Login",
      render: (u: DistributorUser) =>
        u.last_login ? new Date(u.last_login).toLocaleString() : "Never",
    },
    {
      key: "actions",
      header: "Actions",
      render: (u: DistributorUser) => (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => toggleActiveMutation.mutate(u)}>
            {u.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setResetTarget(u)}>
            <KeyRound className="h-3 w-3 mr-1" /> Reset
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(u)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Manage Users"
        description="Create and manage your distributor's sales and manager accounts."
        icon={UserCog}
        action={activeDistributorId ? { label: "Add User", onClick: () => setCreateOpen(true) } : undefined}
      />

      <div className="space-y-4">
        {isCompany && (
          <div className="w-full sm:w-72">
            <Select value={selectedDistributor ?? ""} onValueChange={(v) => setSelectedDistributor(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a distributor..." />
              </SelectTrigger>
              <SelectContent>
                {distributors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!activeDistributorId ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            {isCompany
              ? "Select a distributor to manage their users."
              : "Your account is not linked to a distributor. Contact your administrator."}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={users}
            emptyMessage={isLoading ? "Loading..." : "No users yet"}
          />
        )}
      </div>

      {/* Create user */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>Create a sales, manager or admin account for this distributor.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="user_id">User ID</Label>
              <Input id="user_id" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} placeholder="Login username" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="full_name">Full Name</Label>
              <Input id="full_name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="designation">Designation</Label>
              <Input id="designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Roles</Label>
              <p className="text-xs text-muted-foreground">
                Select one or more. Stack <strong>Admin + Manager</strong> so one person can both manage users and approve orders.
              </p>
              <div className="space-y-2 rounded-lg border p-3">
                {ROLE_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-3 cursor-pointer">
                    <Checkbox
                      checked={form.roles.includes(o.value)}
                      onCheckedChange={(checked) => toggleRole(o.value, checked === true)}
                    />
                    <span className="text-sm">{o.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>Create User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) { setResetTarget(null); setNewPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Reset password for <strong>{resetTarget?.user_id}</strong> ({resetTarget?.full_name})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new_password">New Password</Label>
            <Input id="new_password" type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetTarget(null); setNewPassword(""); }}>Cancel</Button>
            <Button onClick={() => resetMutation.mutate()} disabled={!newPassword || resetMutation.isPending}>
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.user_id}</strong> ({deleteTarget?.full_name})? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
