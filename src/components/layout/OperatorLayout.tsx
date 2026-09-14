import { LogOut, AlertOctagon, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

interface OperatorLayoutProps {
  children: React.ReactNode;
}

// Modules a multi-role inspector may also hold. The inspection entry form has no
// sidebar, so when the logged-in user's roles grant one of these modules, a shortcut
// is shown in the header — otherwise nothing appears and the layout stays locked down.
const EXTRA_MODULE_LINKS = [
  { module: "rejections_wastages", label: "Rejections & Wastages", href: "/rejections/dashboard", icon: AlertOctagon },
  { module: "wip_management", label: "WIP Management", href: "/wip/dashboard", icon: Boxes },
];

export function OperatorLayout({ children }: OperatorLayoutProps) {
  const { user, logout, canAccessModule, canAccessRoute } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const moduleLinks = EXTRA_MODULE_LINKS.filter(
    (link) => canAccessModule(link.module) && canAccessRoute(link.href)
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Simple header with only logout */}
      <header className="sticky top-0 z-30 min-h-16 border-b bg-card">
        <div className="flex min-h-16 items-center justify-between gap-2 flex-wrap px-4 py-2 lg:px-6">
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

          <div className="flex items-center gap-2 flex-wrap">
            {moduleLinks.map((link) => (
              <Button
                key={link.module}
                variant="outline"
                onClick={() => navigate(link.href)}
                className="gap-2"
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </Button>
            ))}

            <Button
              variant="destructive"
              onClick={handleLogout}
              className="gap-2"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="p-4 lg:p-6">
        {children}
      </main>
    </div>
  );
}
