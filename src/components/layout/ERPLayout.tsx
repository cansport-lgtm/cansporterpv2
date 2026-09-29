import { useState } from "react";
import { ERPSidebar } from "./ERPSidebar";
import { ERPHeader } from "./ERPHeader";

interface ERPLayoutProps {
  children: React.ReactNode;
}

export function ERPLayout({ children }: ERPLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-dvh-safe bg-background">
      <ERPSidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      {/* min-w-0 lets wide content (tables, charts) scroll inside their own
          wrappers instead of stretching the page. Below lg the page itself
          never scrolls sideways; `clip` (unlike `hidden`) keeps sticky
          headers inside pages working. */}
      <div className="min-w-0 lg:pl-64">
        <ERPHeader onMenuClick={() => setSidebarOpen(true)} />

        <main className="min-w-0 p-3 pb-[calc(0.75rem_+_var(--safe-bottom))] sm:p-4 sm:pb-4 lg:p-6 lg:pb-6 max-lg:overflow-x-clip">
          {children}
        </main>
      </div>
    </div>
  );
}
