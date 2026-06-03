import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface ModulePermission {
  module_name: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
}

interface ModulePermissionsFormProps {
  permissions: ModulePermission[];
  onChange: (permissions: ModulePermission[]) => void;
}

const MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "production", label: "Production" },
  { key: "planning", label: "Production Planning" },
  { key: "qa", label: "Quality Assurance" },
  { key: "hr", label: "Human Resources" },
  { key: "performance", label: "Performance" },
  { key: "maintenance", label: "Maintenance" },
  { key: "sales", label: "Private Label Sales" },
  { key: "domestic", label: "Sales" },
  { key: "export", label: "Export Sales" },
  { key: "labour", label: "Labour Productivity" },
  { key: "floor_inventory", label: "Floor Inventory" },
   { key: "material_consumption", label: "Material Consumption" },
  { key: "expenses", label: "Expenses" },
  { key: "fixed_assets", label: "Fixed Assets" },
  { key: "purchase", label: "Purchase" },
  { key: "master_data", label: "Master Data" },
  { key: "online_sales", label: "Online Sales" },
  { key: "five_s", label: "5S Audit" },
  { key: "accounting", label: "Accounting" },
  { key: "projects", label: "Project Management" },
  { key: "hourly_production", label: "Hourly Production" },
  { key: "rd", label: "Product Dev & R&D" },
  { key: "crm", label: "CRM" },
  { key: "settings", label: "Settings" },
];

const PERMISSION_TYPES = [
  { key: "can_view", label: "View" },
  { key: "can_create", label: "Create" },
  { key: "can_edit", label: "Edit" },
  { key: "can_delete", label: "Delete" },
  { key: "can_approve", label: "Approve" },
] as const;

export function ModulePermissionsForm({ permissions, onChange }: ModulePermissionsFormProps) {
  const getPermission = (moduleName: string) => {
    return permissions.find((p) => p.module_name === moduleName) || {
      module_name: moduleName,
      can_view: false,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_approve: false,
    };
  };

  const updatePermission = (
    moduleName: string,
    permissionType: keyof Omit<ModulePermission, "module_name">,
    value: boolean
  ) => {
    const existingIndex = permissions.findIndex((p) => p.module_name === moduleName);
    const newPermissions = [...permissions];

    if (existingIndex >= 0) {
      newPermissions[existingIndex] = {
        ...newPermissions[existingIndex],
        [permissionType]: value,
      };
    } else {
      newPermissions.push({
        module_name: moduleName,
        can_view: false,
        can_create: false,
        can_edit: false,
        can_delete: false,
        can_approve: false,
        [permissionType]: value,
      });
    }

    onChange(newPermissions);
  };

  const toggleAllForModule = (moduleName: string, checked: boolean) => {
    const existingIndex = permissions.findIndex((p) => p.module_name === moduleName);
    const newPermissions = [...permissions];

    const newPerm: ModulePermission = {
      module_name: moduleName,
      can_view: checked,
      can_create: checked,
      can_edit: checked,
      can_delete: checked,
      can_approve: checked,
    };

    if (existingIndex >= 0) {
      newPermissions[existingIndex] = newPerm;
    } else {
      newPermissions.push(newPerm);
    }

    onChange(newPermissions);
  };

  const isAllChecked = (moduleName: string) => {
    const perm = getPermission(moduleName);
    return perm.can_view && perm.can_create && perm.can_edit && perm.can_delete && perm.can_approve;
  };

  return (
    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
      <div className="grid grid-cols-7 gap-2 text-xs font-medium text-muted-foreground border-b pb-2 sticky top-0 bg-background">
        <div className="col-span-2">Module</div>
        {PERMISSION_TYPES.map((pt) => (
          <div key={pt.key} className="text-center">{pt.label}</div>
        ))}
      </div>
      {MODULES.map((module) => {
        const perm = getPermission(module.key);
        const allChecked = isAllChecked(module.key);
        
        return (
          <div key={module.key} className="grid grid-cols-7 gap-2 items-center py-1 hover:bg-muted/50 rounded px-1">
            <div className="col-span-2 flex items-center gap-2">
              <Checkbox
                id={`${module.key}-all`}
                checked={allChecked}
                onCheckedChange={(checked) => toggleAllForModule(module.key, !!checked)}
              />
              <Label htmlFor={`${module.key}-all`} className="text-sm font-medium cursor-pointer">
                {module.label}
              </Label>
            </div>
            {PERMISSION_TYPES.map((pt) => (
              <div key={pt.key} className="flex justify-center">
                <Checkbox
                  id={`${module.key}-${pt.key}`}
                  checked={perm[pt.key]}
                  onCheckedChange={(checked) => updatePermission(module.key, pt.key, !!checked)}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export type { ModulePermission };
