import { LogOut, Settings as SettingsIcon, UserCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";

/** Avatar dropdown (Profile / Settings / Logout) shared by every layout so all IDs get it. */
export function UserMenu({ showName = true, variant = "ghost" }: { showName?: boolean; variant?: "ghost" | "outline" }) {
  const { user, roles, logout } = useAuth();
  const navigate = useNavigate();

  const roleLabel = (() => {
    if (roles.some((r) => r.role === "super_admin")) return "Super Admin";
    if (roles.some((r) => r.role === "admin")) return "Admin";
    if (roles.some((r) => r.role === "manager")) return "Manager";
    if (roles.some((r) => r.role === "supervisor")) return "Supervisor";
    if (roles.some((r) => r.role === "operator")) return "Operator";
    return "User";
  })();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} className="gap-2.5 pl-1.5 pr-2 rounded-full hover:bg-muted/70" aria-label="User menu">
          <UserAvatar user={user} className="h-8 w-8 ring-2 ring-background" />
          {showName && (
            <div className="hidden md:block text-left leading-tight">
              <p className="text-sm font-semibold">{user?.full_name || "User"}</p>
              <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
            </div>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-popover shadow-popover-soft">
        <DropdownMenuLabel>
          <div className="flex items-center gap-3 py-1">
            <UserAvatar user={user} className="h-9 w-9" />
            <div className="min-w-0">
              <p className="font-medium truncate">{user?.full_name}</p>
              <p className="text-xs text-muted-foreground font-normal truncate">@{user?.user_id}</p>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" onClick={() => navigate("/profile")}>
          <UserCircle className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onClick={() => navigate("/account-settings")}>
          <SettingsIcon className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive cursor-pointer"
          onClick={() => {
            logout();
            navigate("/login");
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
