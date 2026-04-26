import { Bell, Search, Menu, User, LogOut } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
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

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-border/60 bg-card/80 backdrop-blur-md shadow-soft">
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
          <div className="hidden md:flex items-center relative">
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search orders, products, employees..."
              className="w-80 pl-10 bg-muted/50 border-transparent focus:border-primary"
            />
          </div>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-3">
          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center bg-destructive text-[10px]">
                  5
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 bg-popover">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
                <span className="font-medium text-sm">Purchase Approval Pending</span>
                <span className="text-xs text-muted-foreground">
                  PR-2024-0045 requires your approval
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
                <span className="font-medium text-sm">PM Due Today</span>
                <span className="text-xs text-muted-foreground">
                  3 machines have scheduled maintenance
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
                <span className="font-medium text-sm">QA Hold Alert</span>
                <span className="text-xs text-muted-foreground">
                  Batch #B2024-0089 on hold - NCR pending
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-center text-primary">
                View all notifications
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                <div className="h-8 w-8 rounded-full bg-brand-gradient flex items-center justify-center shadow-soft">
                  <User className="h-4 w-4 text-primary-foreground" />
                </div>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium">{user?.full_name || 'User'}</p>
                  <p className="text-xs text-muted-foreground">{getRoleDisplay()}</p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              <DropdownMenuLabel>
                <div>
                  <p className="font-medium">{user?.full_name}</p>
                  <p className="text-xs text-muted-foreground font-normal">@{user?.user_id}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive focus:text-destructive"
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
