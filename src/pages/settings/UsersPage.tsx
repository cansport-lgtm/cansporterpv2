import { useState, useEffect, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Search, UserCog, Copy, KeyRound, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";
import { ModulePermissionsForm, type ModulePermission } from "@/components/settings/ModulePermissionsForm";
import { RoleAssignmentPanel, type RoleSourceUser } from "@/components/settings/RoleAssignmentPanel";
import {
  ROLE_GROUPS,
  ROLE_META,
  getModuleLabel,
  getRoleFullLabel,
  type AppRole,
  type RoleModuleKey,
} from "@/lib/roleCatalog";

type AppUser = Database["public"]["Tables"]["app_users"]["Row"];

interface UserWithRoles extends AppUser {
  roles: AppRole[];
}

const DEFAULT_PERMISSIONS: ModulePermission[] = [];
const ALL = "__all__";
const MAX_MODULE_BADGES = 3;

interface UserFormValues {
  user_id?: string;
  password?: string;
  full_name: string;
  designation: string;
  is_active?: boolean;
  roles: AppRole[];
}

/** Groups a user's roles by module: [{ module, roles }] in catalogue order. */
function groupRolesByModule(roles: AppRole[]) {
  return ROLE_GROUPS.map((g) => ({
    module: g.key,
    roles: g.roles.filter((r) => roles.includes(r)),
  })).filter((g) => g.roles.length > 0);
}

function UserRolesCell({ roles }: { roles: AppRole[] }) {
  const groups = groupRolesByModule(roles);
  const unknown = roles.filter((r) => !ROLE_META[r]);
  const shown = groups.slice(0, MAX_MODULE_BADGES);
  const hidden = groups.slice(MAX_MODULE_BADGES);
  const groupText = (g: (typeof groups)[number]) =>
    g.module === "administration" || g.module === "general"
      ? g.roles.map((r) => ROLE_META[r].label).join(", ")
      : `${getModuleLabel(g.module)}: ${g.roles.map((r) => ROLE_META[r].label).join(", ")}`;

  return (
    <div className="flex gap-1 flex-wrap max-w-md">
      {shown.map((g) => (
        <Badge key={g.module} variant="outline" className={ROLE_META[g.roles[0]].color}>
          {groupText(g)}
        </Badge>
      ))}
      {unknown.map((r) => (
        <Badge key={r} variant="outline">
          {r.replace(/_/g, " ")}
        </Badge>
      ))}
      {hidden.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="cursor-default">
              +{hidden.length} more
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            <ul className="space-y-0.5 text-xs">
              {hidden.map((g) => (
                <li key={g.module}>{groupText(g)}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function UserFormTabs({
  mode,
  values,
  onChange,
  permissions,
  onPermissionsChange,
  copySources,
  showPassword,
  onTogglePassword,
}: {
  mode: "create" | "edit";
  values: UserFormValues;
  onChange: (values: UserFormValues) => void;
  permissions: ModulePermission[];
  onPermissionsChange: (permissions: ModulePermission[]) => void;
  copySources: RoleSourceUser[];
  showPassword?: boolean;
  onTogglePassword?: () => void;
}) {
  const idPrefix = mode === "create" ? "new" : "edit";
  return (
    <Tabs defaultValue="details" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="roles">
          Roles
          <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
            {values.roles.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="permissions">Module Permissions</TabsTrigger>
      </TabsList>

      <TabsContent value="details" className="space-y-4 pt-2">
        {mode === "create" && (
          <>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}_user_id`}>User ID</Label>
              <Input
                id={`${idPrefix}_user_id`}
                value={values.user_id ?? ""}
                onChange={(e) => onChange({ ...values, user_id: e.target.value })}
                placeholder="Enter user ID"
              />
            </div>
          </>
        )}
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_full_name`}>Full Name</Label>
          <Input
            id={`${idPrefix}_full_name`}
            value={values.full_name}
            onChange={(e) => onChange({ ...values, full_name: e.target.value })}
            placeholder="Enter full name"
          />
        </div>
        {mode === "create" && (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}_password`}>Password</Label>
            <div className="relative">
              <Input
                id={`${idPrefix}_password`}
                type={showPassword ? "text" : "password"}
                value={values.password ?? ""}
                onChange={(e) => onChange({ ...values, password: e.target.value })}
                placeholder="Enter password"
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3"
                onClick={onTogglePassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_designation`}>Designation</Label>
          <Input
            id={`${idPrefix}_designation`}
            value={values.designation}
            onChange={(e) => onChange({ ...values, designation: e.target.value })}
            placeholder="Enter designation"
          />
        </div>
        {mode === "edit" && (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}_status`}>Status</Label>
            <Select
              value={values.is_active ? "active" : "inactive"}
              onValueChange={(value) => onChange({ ...values, is_active: value === "active" })}
            >
              <SelectTrigger id={`${idPrefix}_status`}>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </TabsContent>

      <TabsContent value="roles" className="pt-2">
        <RoleAssignmentPanel
          selected={values.roles}
          onChange={(roles) => onChange({ ...values, roles })}
          copySources={copySources}
        />
      </TabsContent>

      <TabsContent value="permissions" className="pt-2">
        <ModulePermissionsForm permissions={permissions} onChange={onPermissionsChange} />
      </TabsContent>
    </Tabs>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>(ALL);
  const [roleFilter, setRoleFilter] = useState<string>(ALL);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithRoles | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newUserPermissions, setNewUserPermissions] = useState<ModulePermission[]>(DEFAULT_PERMISSIONS);
  const [editUserPermissions, setEditUserPermissions] = useState<ModulePermission[]>([]);
  const isMobile = useIsMobile();
  const [newUser, setNewUser] = useState<UserFormValues>({
    user_id: "",
    full_name: "",
    password: "",
    designation: "",
    roles: ["viewer"],
  });
  const [editUser, setEditUser] = useState<UserFormValues>({
    full_name: "",
    designation: "",
    is_active: true,
    roles: ["viewer"],
  });
  const { toast } = useToast();

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const fetchAllRoles = async () => {
        // Page through user_roles — a single request is capped at 1000 rows.
        const PAGE = 1000;
        const rows: { user_id: string; role: AppRole }[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("user_roles")
            .select("user_id, role")
            .order("id")
            .range(from, from + PAGE - 1);
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < PAGE) return rows;
        }
      };

      const [{ data: usersData, error: usersError }, rolesData] = await Promise.all([
        supabase.from("app_users").select("*").order("created_at", { ascending: false }),
        fetchAllRoles(),
      ]);

      if (usersError) throw usersError;

      const rolesByUser = new Map<string, AppRole[]>();
      for (const { user_id, role } of rolesData) {
        const list = rolesByUser.get(user_id) ?? [];
        list.push(role);
        rolesByUser.set(user_id, list);
      }

      setUsers((usersData || []).map((user) => ({ ...user, roles: rolesByUser.get(user.id) ?? [] })));
    } catch (error) {
      console.error("Error fetching users:", error);
      toast({
        title: "Error",
        description: "Failed to fetch users",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async () => {
    if (newUser.roles.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one role",
        variant: "destructive",
      });
      return;
    }
    try {
      // Create user using the RPC function
      const { data, error } = await supabase.rpc("create_app_user", {
        p_user_id: newUser.user_id ?? "",
        p_full_name: newUser.full_name,
        p_password: newUser.password ?? "",
        p_designation: newUser.designation || null,
      });

      if (error) throw error;

      const userId = data;

      // Add roles
      const { error: roleError } = await supabase.from("user_roles").insert(
        newUser.roles.map((role) => ({ user_id: userId, role }))
      );

      if (roleError) throw roleError;

      // Add module permissions
      if (newUserPermissions.length > 0) {
        const permissionsToInsert = newUserPermissions
          .filter((p) => p.can_view || p.can_create || p.can_edit || p.can_delete || p.can_approve)
          .map((p) => ({
            user_id: userId,
            module_name: p.module_name,
            can_view: p.can_view,
            can_create: p.can_create,
            can_edit: p.can_edit,
            can_delete: p.can_delete,
            can_approve: p.can_approve,
          }));

        if (permissionsToInsert.length > 0) {
          const { error: permError } = await supabase.from("module_permissions").insert(permissionsToInsert);
          if (permError) throw permError;
        }
      }

      toast({
        title: "Success",
        description: "User created successfully",
      });

      setIsDialogOpen(false);
      setNewUser({
        user_id: "",
        full_name: "",
        password: "",
        designation: "",
        roles: ["viewer"],
      });
      setNewUserPermissions([]);
      fetchUsers();
    } catch (error: any) {
      console.error("Error creating user:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser || !newPassword) return;

    try {
      const { error } = await supabase.rpc("reset_user_password", {
        p_user_uuid: selectedUser.id,
        p_new_password: newPassword,
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Password reset successfully",
      });

      setIsResetPasswordOpen(false);
      setNewPassword("");
      setSelectedUser(null);
    } catch (error: any) {
      console.error("Error resetting password:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to reset password",
        variant: "destructive",
      });
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;

    if (editUser.roles.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one role",
        variant: "destructive",
      });
      return;
    }

    try {
      // Update user details
      const { error: userError } = await supabase
        .from("app_users")
        .update({
          full_name: editUser.full_name,
          designation: editUser.designation,
          is_active: editUser.is_active,
        })
        .eq("id", selectedUser.id);

      if (userError) throw userError;

      // Update roles - first delete existing roles, then add the selected ones
      const { error: deleteRoleError } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", selectedUser.id);

      if (deleteRoleError) throw deleteRoleError;

      const { error: roleError } = await supabase.from("user_roles").insert(
        editUser.roles.map((role) => ({ user_id: selectedUser.id, role }))
      );

      if (roleError) throw roleError;

      // Update module permissions - delete existing, then insert new ones
      const { error: deletePermError } = await supabase
        .from("module_permissions")
        .delete()
        .eq("user_id", selectedUser.id);

      if (deletePermError) throw deletePermError;

      if (editUserPermissions.length > 0) {
        const permissionsToInsert = editUserPermissions
          .filter((p) => p.can_view || p.can_create || p.can_edit || p.can_delete || p.can_approve)
          .map((p) => ({
            user_id: selectedUser.id,
            module_name: p.module_name,
            can_view: p.can_view,
            can_create: p.can_create,
            can_edit: p.can_edit,
            can_delete: p.can_delete,
            can_approve: p.can_approve,
          }));

        if (permissionsToInsert.length > 0) {
          const { error: permError } = await supabase.from("module_permissions").insert(permissionsToInsert);
          if (permError) throw permError;
        }
      }

      toast({
        title: "Success",
        description: "User updated successfully",
      });

      setIsEditDialogOpen(false);
      setSelectedUser(null);
      setEditUserPermissions([]);
      fetchUsers();
    } catch (error: any) {
      console.error("Error updating user:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update user",
        variant: "destructive",
      });
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    try {
      // Delete user roles first
      const { error: roleError } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", selectedUser.id);

      if (roleError) throw roleError;

      // Delete the user
      const { error: userError } = await supabase
        .from("app_users")
        .delete()
        .eq("id", selectedUser.id);

      if (userError) throw userError;

      toast({
        title: "Success",
        description: "User deleted successfully",
      });

      setIsDeleteDialogOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (error: any) {
      console.error("Error deleting user:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = async (user: UserWithRoles) => {
    setSelectedUser(user);
    setEditUser({
      full_name: user.full_name,
      designation: user.designation || "",
      is_active: user.is_active ?? true,
      roles: user.roles.length > 0 ? user.roles : ["viewer"],
    });

    // Fetch existing module permissions
    const { data: perms } = await supabase
      .from("module_permissions")
      .select("module_name, can_view, can_create, can_edit, can_delete, can_approve")
      .eq("user_id", user.id);

    if (perms) {
      setEditUserPermissions(
        perms.map((p) => ({
          module_name: p.module_name,
          can_view: p.can_view ?? false,
          can_create: p.can_create ?? false,
          can_edit: p.can_edit ?? false,
          can_delete: p.can_delete ?? false,
          can_approve: p.can_approve ?? false,
        }))
      );
    } else {
      setEditUserPermissions([]);
    }

    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (user: UserWithRoles) => {
    setSelectedUser(user);
    setIsDeleteDialogOpen(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "User ID copied to clipboard",
    });
  };

  // Users whose roles can be copied (excluding the user being edited).
  const copySources = useMemo<RoleSourceUser[]>(
    () =>
      users
        .filter((u) => u.roles.length > 0 && u.id !== selectedUser?.id)
        .map((u) => ({ id: u.id, user_id: u.user_id, full_name: u.full_name, roles: u.roles })),
    [users, selectedUser]
  );

  // Role filter options follow the module filter; only roles that some user holds.
  const roleFilterOptions = useMemo(() => {
    const held = new Set(users.flatMap((u) => u.roles));
    return ROLE_GROUPS.filter((g) => moduleFilter === ALL || g.key === moduleFilter)
      .flatMap((g) => g.roles)
      .filter((r) => held.has(r));
  }, [users, moduleFilter]);

  const moduleFilterOptions = useMemo(() => {
    const held = new Set(users.flatMap((u) => u.roles.map((r) => ROLE_META[r]?.module)));
    return ROLE_GROUPS.filter((g) => held.has(g.key));
  }, [users]);

  const filteredUsers = users.filter((user) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      user.user_id.toLowerCase().includes(term) ||
      user.full_name.toLowerCase().includes(term) ||
      (user.designation ?? "").toLowerCase().includes(term);
    const matchesModule =
      moduleFilter === ALL || user.roles.some((r) => ROLE_META[r]?.module === (moduleFilter as RoleModuleKey));
    const matchesRole = roleFilter === ALL || user.roles.includes(roleFilter as AppRole);
    return matchesSearch && matchesModule && matchesRole;
  });

  const columns = [
    {
      key: "user_id",
      header: "User ID",
      render: (item: UserWithRoles) => (
        <div className="flex items-center gap-2">
          <code className="bg-muted px-2 py-1 rounded text-sm font-mono">{item.user_id}</code>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => copyToClipboard(item.user_id)}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
    { key: "full_name", header: "Full Name" },
    { key: "designation", header: "Designation" },
    {
      key: "roles",
      header: "Roles",
      render: (item: UserWithRoles) => <UserRolesCell roles={item.roles} />,
    },
    {
      key: "is_active",
      header: "Status",
      render: (item: UserWithRoles) => (
        <StatusBadge status={item.is_active ? "approved" : "rejected"} />
      ),
    },
    {
      key: "last_login",
      header: "Last Login",
      render: (item: UserWithRoles) =>
        item.last_login ? new Date(item.last_login).toLocaleString() : "Never",
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: UserWithRoles) => (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openEditDialog(item)}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedUser(item);
              setIsResetPasswordOpen(true);
            }}
          >
            <KeyRound className="h-3 w-3 mr-1" />
            Reset
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => openDeleteDialog(item)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  const createForm = (
    <UserFormTabs
      mode="create"
      values={newUser}
      onChange={setNewUser}
      permissions={newUserPermissions}
      onPermissionsChange={setNewUserPermissions}
      copySources={copySources}
      showPassword={showPassword}
      onTogglePassword={() => setShowPassword(!showPassword)}
    />
  );

  const editForm = (
    <UserFormTabs
      // Remount per user so the role panel re-opens that user's modules.
      key={selectedUser?.id ?? "none"}
      mode="edit"
      values={editUser}
      onChange={setEditUser}
      permissions={editUserPermissions}
      onPermissionsChange={setEditUserPermissions}
      copySources={copySources}
    />
  );

  return (
    <ERPLayout>
      <PageHeader
        title="User Management"
        description="Manage system users and their access"
        icon={UserCog}
      />

      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row gap-3 justify-between">
          <div className="flex flex-col sm:flex-row gap-2 flex-1">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={moduleFilter}
              onValueChange={(v) => {
                setModuleFilter(v);
                setRoleFilter(ALL);
              }}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="All modules" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All modules</SelectItem>
                {moduleFilterOptions.map((g) => (
                  <SelectItem key={g.key} value={g.key}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All roles</SelectItem>
                {roleFilterOptions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {getRoleFullLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>

        {(moduleFilter !== ALL || roleFilter !== ALL) && (
          <p className="text-sm text-muted-foreground">
            {filteredUsers.length} user{filteredUsers.length === 1 ? "" : "s"} with{" "}
            {roleFilter !== ALL
              ? getRoleFullLabel(roleFilter as AppRole)
              : `a ${getModuleLabel(moduleFilter as RoleModuleKey)} role`}
            .{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                setModuleFilter(ALL);
                setRoleFilter(ALL);
              }}
            >
              Clear filters
            </button>
          </p>
        )}

        {/* Add User - Mobile Drawer / Desktop Dialog */}
        {isMobile === true ? (
          <Drawer open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Create New User</DrawerTitle>
                <DrawerDescription>
                  Add a new user to the system
                </DrawerDescription>
              </DrawerHeader>
              <div className="max-h-[70vh] overflow-y-auto px-4">{createForm}</div>
              <DrawerFooter className="flex-row gap-2">
                <DrawerClose asChild>
                  <Button variant="outline" className="flex-1">Cancel</Button>
                </DrawerClose>
                <Button onClick={handleCreateUser} className="flex-1">Create User</Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        ) : isMobile === false ? (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent className="sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
                <DialogDescription>
                  Add a new user to the system
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[75vh] overflow-y-auto pr-2">{createForm}</div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateUser}>Create User</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}

        <DataTable
          columns={columns}
          data={filteredUsers}
          emptyMessage={isLoading ? "Loading..." : "No users found"}
        />

        {/* Reset Password Dialog */}
        <Dialog open={isResetPasswordOpen} onOpenChange={setIsResetPasswordOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Password</DialogTitle>
              <DialogDescription>
                Reset password for user: <strong>{selectedUser?.user_id}</strong> ({selectedUser?.full_name})
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="new_password">New Password</Label>
                <div className="relative">
                  <Input
                    id="new_password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setIsResetPasswordOpen(false);
                setNewPassword("");
                setSelectedUser(null);
              }}>
                Cancel
              </Button>
              <Button onClick={handleResetPassword}>Reset Password</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit User - Mobile Drawer / Desktop Dialog */}
        {isMobile === true ? (
          <Drawer open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Edit User</DrawerTitle>
                <DrawerDescription>
                  Update details for user: <strong>{selectedUser?.user_id}</strong>
                </DrawerDescription>
              </DrawerHeader>
              <div className="max-h-[70vh] overflow-y-auto px-4">{editForm}</div>
              <DrawerFooter className="flex-row gap-2">
                <DrawerClose asChild>
                  <Button variant="outline" className="flex-1" onClick={() => setSelectedUser(null)}>Cancel</Button>
                </DrawerClose>
                <Button onClick={handleEditUser} className="flex-1">Save Changes</Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        ) : isMobile === false ? (
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogContent className="sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle>Edit User</DialogTitle>
                <DialogDescription>
                  Update details for user: <strong>{selectedUser?.user_id}</strong>
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[75vh] overflow-y-auto pr-2">{editForm}</div>
              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  setIsEditDialogOpen(false);
                  setSelectedUser(null);
                }}>
                  Cancel
                </Button>
                <Button onClick={handleEditUser}>Save Changes</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}

        {/* Delete User Confirmation */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete User</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete user <strong>{selectedUser?.user_id}</strong> ({selectedUser?.full_name})?
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setSelectedUser(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteUser}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
