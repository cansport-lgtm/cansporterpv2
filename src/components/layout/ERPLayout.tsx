import { useState } from "react";
import { ERPSidebar } from "./ERPSidebar";
import { ERPHeader } from "./ERPHeader";

interface ERPLayoutProps {
  children: React.ReactNode;
}

export function ERPLayout({ children }: ERPLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* App chrome is hidden while printing so in-app print layouts (e.g. the
          party ledger) can render in normal document flow and paginate across
          as many pages as needed, instead of being masked by a fixed overlay
          that only prints the first page. */}
      <div className="print:hidden">
        <ERPSidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      </div>

      <div className="lg:pl-64 print:pl-0">
        <div className="print:hidden">
          <ERPHeader onMenuClick={() => setSidebarOpen(true)} />
        </div>

        <main className="p-4 lg:p-6 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
