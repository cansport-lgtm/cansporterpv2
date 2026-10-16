import { LogOut, Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

interface OrderManagementLayoutProps {
  children: React.ReactNode;
}

export function OrderManagementLayout({ children }: OrderManagementLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-dvh-safe bg-background">
      <header className="sticky top-0 z-30 border-b bg-card pt-safe">
        <div className="flex h-14 sm:h-16 items-center justify-between gap-2 px-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-8 w-8 shrink-0 rounded-lg bg-primary flex items-center justify-center">
              <Factory className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-base sm:text-lg truncate">Production Orders</h1>
              <p className="text-xs text-muted-foreground truncate">
                {user?.full_name || "Order Management"}
              </p>
            </div>
          </div>

          <Button variant="destructive" onClick={handleLogout} className="gap-2 shrink-0" aria-label="Logout">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </header>

      <main className="min-w-0 p-3 pb-[calc(0.75rem_+_var(--safe-bottom))] sm:p-4 sm:pb-4 lg:p-6 lg:pb-6 max-lg:overflow-x-clip">
        {children}
      </main>
    </div>
  );
}
