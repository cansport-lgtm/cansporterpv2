import { useState, useEffect } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, UserCog, Copy, KeyRound, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";
import { ModulePermissionsForm, type ModulePermission } from "@/components/settings/ModulePermissionsForm";

type AppUser = Database["public"]["Tables"]["app_users"]["Row"];
type AppRole = Database["public"]["Enums"]["app_role"];

interface UserWithRoles extends AppUser {
  roles: AppRole[];
}

const DEFAULT_PERMISSIONS: ModulePermission[] = [];

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "billing_officer", label: "Billing Officer (Sales + Purchase invoicing)" },
  { value: "purchase_officer", label: "Purchase Officer (create POs)" },
  { value: "purchase_manager", label: "Purchase Manager (approve POs)" },
  { value: "purchase_qc_inspector", label: "Purchase QC Inspector (inspect & approve, no prices)" },
  { value: "accounting_poster", label: "Accounting — Poster (entries only)" },
  { value: "accounting_officer", label: "Accounting — Officer (no P&L / Balance Sheet)" },
  { value: "accounting_manager", label: "Accounting — Manager (full + approve)" },
  { value: "operational_manager", label: "Operational Manager" },
  { value: "qa_manager", label: "QA Manager" },
  { value: "maintenance_manager", label: "Maintenance Manager" },
  { value: "sales_executive", label: "Sales Executive" },
  { value: "order_management", label: "Order Management" },
  { value: "floor_incharge", label: "Floor Incharge" },
  { value: "private_label_distributor", label: "Private Label Distributor" },
  { value: "pettycash_handler", label: "Pettycash Handler" },
  { value: "store_operator", label: "Store Operator" },
  { value: "online_sales_packing", label: "Online Sales Packing" },
  { value: "online_sales_admin", label: "Online Sales Admin (full module)" },
  { value: "online_sales_manager", label: "Online Sales Manager (full module, no delete)" },
  { value: "online_sales_agent", label: "Online Sales Agent (fulfilment only, no prices)" },
  { value: "dispatch_operator", label: "Dispatch Operator (create dispatch, no prices)" },
  { value: "sales_order_manager", label: "Sales Order Management (orders + dispatch, no prices/invoices)" },
  { value: "production_operator", label: "Production Operator (post production + planning, edit ≤48h)" },
  { value: "closing_data_poster", label: "Closing Data Poster (Daily Stock Closing + Stock Closing only)" },
  // Distributor roles are intentionally NOT listed here: they require a distributor_id,
  // which is assigned in the Distributor module's "Manage Users" page (Distributor Orders →
  // Manage Users). Creating them here would leave distributor_id NULL and break isolation.
  { value: "manager", label: "Manager" },
  { value: "supervisor", label: "Supervisor" },
  { value: "operator", label: "Operator" },
  { value: "viewer", label: "Viewer" },
];

function RolesCheckboxGroup({
  selected,
  onChange,
}: {
  selected: AppRole[];
  onChange: (roles: AppRole[]) => void;
}) {
  const toggle = (role: AppRole, checked: boolean) => {
    if (checked) onChange([...selected, role]);
    else onChange(selected.filter((r) => r !== role));
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border p-3">
      {ROLE_OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className="flex items-center gap-2 text-sm cursor-pointer"
        >
          <Checkbox
            checked={selected.includes(opt.value)}
            onCheckedChange={(c) => toggle(opt.value, c === true)}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
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
  const [newUser, setNewUser] = useState({
    user_id: "",
    full_name: "",
    password: "",
    designation: "",
    roles: ["viewer"] as AppRole[],
  });
  const [editUser, setEditUser] = useState({
    full_name: "",
    designation: "",
    is_active: true,
    roles: ["viewer"] as AppRole[],
  });
  const { toast } = useToast();

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const { data: usersData, error: usersError } = await supabase
        .from("app_users")
        .select("*")
        .order("created_at", { ascending: false });

      if (usersError) throw usersError;

      // Fetch roles for each user
      const usersWithRoles = await Promise.all(
        (usersData || []).map(async (user) => {
          const { data: rolesData } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id);
          return {
            ...user,
            roles: (rolesData || []).map((r) => r.role),
          };
        })
      );

      setUsers(usersWithRoles);
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
        p_user_id: newUser.user_id,
        p_full_name: newUser.full_name,
        p_password: newUser.password,
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

  const filteredUsers = users.filter(
    (user) =>
      user.user_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadgeColor = (role: AppRole) => {
    const colors: Record<AppRole, string> = {
      super_admin: "bg-red-500/10 text-red-500",
      admin: "bg-orange-500/10 text-orange-500",
      manager: "bg-blue-500/10 text-blue-500",
      supervisor: "bg-purple-500/10 text-purple-500",
      operator: "bg-green-500/10 text-green-500",
      viewer: "bg-gray-500/10 text-gray-500",
      operational_manager: "bg-teal-500/10 text-teal-500",
      qa_manager: "bg-cyan-500/10 text-cyan-500",
      maintenance_manager: "bg-amber-500/10 text-amber-500",
      sales_executive: "bg-indigo-500/10 text-indigo-500",
      order_management: "bg-pink-500/10 text-pink-500",
      floor_incharge: "bg-lime-500/10 text-lime-500",
      private_label_distributor: "bg-emerald-500/10 text-emerald-500",
      pettycash_handler: "bg-yellow-500/10 text-yellow-500",
      store_operator: "bg-sky-500/10 text-sky-500",
      project_manager: "bg-violet-500/10 text-violet-500",
      online_sales_packing: "bg-rose-500/10 text-rose-500",
      online_sales_admin: "bg-rose-700/10 text-rose-700",
      online_sales_manager: "bg-rose-600/10 text-rose-600",
      online_sales_agent: "bg-pink-600/10 text-pink-600",
      accounting_poster: "bg-teal-500/10 text-teal-500",
      accounting_officer: "bg-cyan-500/10 text-cyan-500",
      accounting_manager: "bg-emerald-500/10 text-emerald-500",
      billing_officer: "bg-fuchsia-500/10 text-fuchsia-500",
      purchase_officer: "bg-teal-600/10 text-teal-600",
      purchase_manager: "bg-blue-700/10 text-blue-700",
      purchase_qc_inspector: "bg-emerald-600/10 text-emerald-600",
      dispatch_operator: "bg-orange-600/10 text-orange-600",
      sales_order_manager: "bg-indigo-600/10 text-indigo-600",
      production_operator: "bg-blue-600/10 text-blue-600",
      closing_data_poster: "bg-purple-600/10 text-purple-600",
      distributor_sales: "bg-amber-500/10 text-amber-500",
      distributor_manager: "bg-amber-600/10 text-amber-600",
      distributor_admin: "bg-amber-700/10 text-amber-700",
    };
    return colors[role] || "";
  };

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
      render: (item: UserWithRoles) => (
        <div className="flex gap-1 flex-wrap">
          {item.roles.map((role) => (
            <Badge key={role} variant="outline" className={getRoleBadgeColor(role)}>
              {role.replace("_", " ")}
            </Badge>
          ))}
        </div>
      ),
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

  return (
    <ERPLayout>
      <PageHeader
        title="User Management"
        description="Manage system users and their access"
        icon={UserCog}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>

        {/* Add User - Mobile Drawer */}
        {isMobile === true ? (
          <Drawer open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Create New User</DrawerTitle>
                <DrawerDescription>
                  Add a new user to the system
                </DrawerDescription>
              </DrawerHeader>
              <ScrollArea className="max-h-[60vh] px-4">
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="user_id_mobile">User ID</Label>
                    <Input
                      id="user_id_mobile"
                      value={newUser.user_id}
                      onChange={(e) =>
                        setNewUser({ ...newUser, user_id: e.target.value })
                      }
                      placeholder="Enter user ID"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="full_name_mobile">Full Name</Label>
                    <Input
                      id="full_name_mobile"
                      value={newUser.full_name}
                      onChange={(e) =>
                        setNewUser({ ...newUser, full_name: e.target.value })
                      }
                      placeholder="Enter full name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password_mobile">Password</Label>
                    <div className="relative">
                      <Input
                        id="password_mobile"
                        type={showPassword ? "text" : "password"}
                        value={newUser.password}
                        onChange={(e) =>
                          setNewUser({ ...newUser, password: e.target.value })
                        }
                        placeholder="Enter password"
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
                    <Label htmlFor="designation_mobile">Designation</Label>
                    <Input
                      id="designation_mobile"
                      value={newUser.designation}
                      onChange={(e) =>
                        setNewUser({ ...newUser, designation: e.target.value })
                      }
                      placeholder="Enter designation"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role_mobile">Roles</Label>
                    <RolesCheckboxGroup
                      selected={newUser.roles}
                      onChange={(roles) => setNewUser({ ...newUser, roles })}
                    />
                  </div>
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="permissions">
                      <AccordionTrigger className="text-sm font-medium">
                        Module Permissions
                      </AccordionTrigger>
                      <AccordionContent>
                        <ModulePermissionsForm
                          permissions={newUserPermissions}
                          onChange={setNewUserPermissions}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </ScrollArea>
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
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
                <DialogDescription>
                  Add a new user to the system
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
                  <div className="space-y-2">
                    <Label htmlFor="user_id">User ID</Label>
                    <Input
                      id="user_id"
                      value={newUser.user_id}
                      onChange={(e) =>
                        setNewUser({ ...newUser, user_id: e.target.value })
                      }
                      placeholder="Enter user ID"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Full Name</Label>
                    <Input
                      id="full_name"
                      value={newUser.full_name}
                      onChange={(e) =>
                        setNewUser({ ...newUser, full_name: e.target.value })
                      }
                      placeholder="Enter full name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={newUser.password}
                        onChange={(e) =>
                          setNewUser({ ...newUser, password: e.target.value })
                        }
                        placeholder="Enter password"
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
                    <Input
                      id="designation"
                      value={newUser.designation}
                      onChange={(e) =>
                        setNewUser({ ...newUser, designation: e.target.value })
                      }
                      placeholder="Enter designation"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Roles</Label>
                    <RolesCheckboxGroup
                      selected={newUser.roles}
                      onChange={(roles) => setNewUser({ ...newUser, roles })}
                    />
                  </div>
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="permissions">
                      <AccordionTrigger className="text-sm font-medium">
                        Module Permissions
                      </AccordionTrigger>
                      <AccordionContent>
                        <ModulePermissionsForm
                          permissions={newUserPermissions}
                          onChange={setNewUserPermissions}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
              </div>
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

        {/* Edit User Dialog */}
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
              <ScrollArea className="max-h-[60vh] px-4">
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit_full_name_mobile">Full Name</Label>
                    <Input
                      id="edit_full_name_mobile"
                      value={editUser.full_name}
                      onChange={(e) =>
                        setEditUser({ ...editUser, full_name: e.target.value })
                      }
                      placeholder="Enter full name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_designation_mobile">Designation</Label>
                    <Input
                      id="edit_designation_mobile"
                      value={editUser.designation}
                      onChange={(e) =>
                        setEditUser({ ...editUser, designation: e.target.value })
                      }
                      placeholder="Enter designation"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_role_mobile">Roles</Label>
                    <RolesCheckboxGroup
                      selected={editUser.roles}
                      onChange={(roles) => setEditUser({ ...editUser, roles })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_status_mobile">Status</Label>
                    <Select
                      value={editUser.is_active ? "active" : "inactive"}
                      onValueChange={(value) =>
                        setEditUser({ ...editUser, is_active: value === "active" })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="permissions">
                      <AccordionTrigger className="text-sm font-medium">
                        Module Permissions
                      </AccordionTrigger>
                      <AccordionContent>
                        <ModulePermissionsForm
                          permissions={editUserPermissions}
                          onChange={setEditUserPermissions}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </ScrollArea>
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
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Edit User</DialogTitle>
                <DialogDescription>
                  Update details for user: <strong>{selectedUser?.user_id}</strong>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
                <div className="space-y-2">
                  <Label htmlFor="edit_full_name">Full Name</Label>
                  <Input
                    id="edit_full_name"
                    value={editUser.full_name}
                    onChange={(e) =>
                      setEditUser({ ...editUser, full_name: e.target.value })
                    }
                    placeholder="Enter full name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_designation">Designation</Label>
                  <Input
                    id="edit_designation"
                    value={editUser.designation}
                    onChange={(e) =>
                      setEditUser({ ...editUser, designation: e.target.value })
                    }
                    placeholder="Enter designation"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_role">Roles</Label>
                  <RolesCheckboxGroup
                    selected={editUser.roles}
                    onChange={(roles) => setEditUser({ ...editUser, roles })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_status">Status</Label>
                  <Select
                    value={editUser.is_active ? "active" : "inactive"}
                    onValueChange={(value) =>
                      setEditUser({ ...editUser, is_active: value === "active" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="permissions">
                    <AccordionTrigger className="text-sm font-medium">
                      Module Permissions
                    </AccordionTrigger>
                    <AccordionContent>
                      <ModulePermissionsForm
                        permissions={editUserPermissions}
                        onChange={setEditUserPermissions}
                      />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
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