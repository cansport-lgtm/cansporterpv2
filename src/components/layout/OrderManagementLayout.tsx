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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 h-16 border-b bg-card">
        <div className="flex h-full items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Factory className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-semibold text-lg">Production Orders</h1>
              <p className="text-xs text-muted-foreground">
                {user?.full_name || "Order Management"}
              </p>
            </div>
          </div>

          <Button variant="destructive" onClick={handleLogout} className="gap-2">
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </header>

      <main className="p-4 lg:p-6">{children}</main>
    </div>
  );
}
