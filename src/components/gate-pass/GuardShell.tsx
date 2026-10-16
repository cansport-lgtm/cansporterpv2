import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

/** Guards get a bare full-screen page with just a logout; everyone else uses ERPLayout. */
export function GuardShell({ children, title = "Gate Check" }: { children: React.ReactNode; title?: string }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 bg-slate-900 text-white">
        <div className="flex items-center justify-between px-4 h-14">
          <div>
            <div className="font-display font-bold text-lg leading-tight">{title}</div>
            <div className="text-xs text-slate-300">{user?.full_name ?? "Security"}</div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => { logout(); navigate("/login"); }}>
            <LogOut className="h-4 w-4 mr-1" /> Logout
          </Button>
        </div>
      </header>
      <main className="p-3 sm:p-4 max-w-xl mx-auto">{children}</main>
    </div>
  );
}
