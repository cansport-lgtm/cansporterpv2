import { Bell, Search, Menu, User, LogOut, Settings as SettingsIcon, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

interface ERPHeaderProps {
  onMenuClick: () => void;
}

export function ERPHeader({ onMenuClick }: ERPHeaderProps) {
  const { user, roles, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getRoleDisplay = () => {
    if (roles.some(r => r.role === 'super_admin')) return 'Super Admin';
    if (roles.some(r => r.role === 'admin')) return 'Admin';
    if (roles.some(r => r.role === 'manager')) return 'Manager';
    if (roles.some(r => r.role === 'supervisor')) return 'Supervisor';
    if (roles.some(r => r.role === 'operator')) return 'Operator';
    return 'User';
  };

  const getInitials = () => {
    const name = user?.full_name || user?.user_id || 'U';
    return name
      .split(' ')
      .map(part => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-border/60 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center justify-between px-4 lg:px-6">
        {/* Left section */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Search */}
          <div className="hidden md:flex items-center relative group">
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <Input
              placeholder="Search orders, products, employees..."
              className="w-80 pl-10 h-10 bg-muted/50 border-transparent placeholder:text-muted-foreground/60 focus:bg-card focus:border-input focus-visible:ring-1"
            />
            <kbd className="pointer-events-none absolute right-3 inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-card px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-70">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2">
          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative rounded-full">
                <Bell className="h-5 w-5" />
                <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/70 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background" />
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 bg-popover shadow-popover-soft">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>Notifications</span>
                <span className="rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5">
                  5 new
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="flex flex-col items-start gap-1 py-3 cursor-pointer">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <span className="font-medium text-sm">Purchase Approval Pending</span>
                </div>
                <span className="text-xs text-muted-foreground pl-3.5">
                  PR-2024-0045 requires your approval
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex flex-col items-start gap-1 py-3 cursor-pointer">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  <span className="font-medium text-sm">PM Due Today</span>
                </div>
                <span className="text-xs text-muted-foreground pl-3.5">
                  3 machines have scheduled maintenance
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex flex-col items-start gap-1 py-3 cursor-pointer">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  <span className="font-medium text-sm">QA Hold Alert</span>
                </div>
                <span className="text-xs text-muted-foreground pl-3.5">
                  Batch #B2024-0089 on hold — NCR pending
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-center text-primary font-medium justify-center">
                View all notifications
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="hidden md:block h-6 w-px bg-border/80 mx-1" />

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2.5 pl-1.5 pr-2 rounded-full hover:bg-muted/70">
                <div className="h-8 w-8 rounded-full bg-brand-gradient flex items-center justify-center shadow-soft ring-2 ring-background">
                  <span className="text-[11px] font-semibold text-primary-foreground tracking-wider">
                    {getInitials()}
                  </span>
                </div>
                <div className="hidden md:block text-left leading-tight">
                  <p className="text-sm font-semibold">{user?.full_name || 'User'}</p>
                  <p className="text-[11px] text-muted-foreground">{getRoleDisplay()}</p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-popover shadow-popover-soft">
              <DropdownMenuLabel>
                <div className="flex items-center gap-3 py-1">
                  <div className="h-9 w-9 rounded-full bg-brand-gradient flex items-center justify-center shadow-soft">
                    <span className="text-xs font-semibold text-primary-foreground">
                      {getInitials()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{user?.full_name}</p>
                    <p className="text-xs text-muted-foreground font-normal truncate">@{user?.user_id}</p>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer">
                <UserCircle className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer">
                <SettingsIcon className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive cursor-pointer"
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
