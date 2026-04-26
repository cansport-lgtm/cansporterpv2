import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

interface OperatorLayoutProps {
  children: React.ReactNode;
}

export function OperatorLayout({ children }: OperatorLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Simple header with only logout */}
      <header className="sticky top-0 z-30 h-16 border-b bg-card">
        <div className="flex h-full items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">QA</span>
            </div>
            <div>
              <h1 className="font-semibold text-lg">Quality Inspection</h1>
              <p className="text-xs text-muted-foreground">
                {user?.full_name || 'Operator'}
              </p>
            </div>
          </div>

          <Button 
            variant="destructive" 
            onClick={handleLogout}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </header>

      <main className="p-4 lg:p-6">
        {children}
      </main>
    </div>
  );
}
