import { UserMenu } from "@/components/layout/UserMenu";
import { useAuth } from "@/contexts/AuthContext";

/** Guards get a bare full-screen page with just a logout; everyone else uses ERPLayout. */
export function GuardShell({ children, title = "Gate Check" }: { children: React.ReactNode; title?: string }) {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 bg-slate-900 text-white">
        <div className="flex items-center justify-between px-4 h-14">
          <div>
            <div className="font-display font-bold text-lg leading-tight">{title}</div>
            <div className="text-xs text-slate-300">{user?.full_name ?? "Security"}</div>
          </div>
          <UserMenu showName={false} variant="outline" />
        </div>
      </header>
      <main className="p-3 sm:p-4 max-w-xl mx-auto">{children}</main>
    </div>
  );
}
