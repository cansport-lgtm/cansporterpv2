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
      <ERPSidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      
      <div className="lg:pl-64">
        <ERPHeader onMenuClick={() => setSidebarOpen(true)} />
        
        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
