import { useEffect, useState } from "react";
import { ERPSidebar } from "./ERPSidebar";
import { ERPHeader } from "./ERPHeader";
import { cn } from "@/lib/utils";

interface ERPLayoutProps {
  children: React.ReactNode;
}

const COLLAPSED_STORAGE_KEY = "erp-sidebar-collapsed";

const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export function ERPLayout({ children }: ERPLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop-only: shrinks the sidebar to an icon rail. Remembered across reloads.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // Storage unavailable (private mode etc.) — the toggle still works for this session.
    }
  }, [sidebarCollapsed]);

  // Ctrl/Cmd + B toggles the sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <ERPSidebar
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
      />

      <div
        className={cn(
          "transition-[padding] duration-300",
          sidebarCollapsed ? "lg:pl-[72px]" : "lg:pl-64"
        )}
      >
        <ERPHeader onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
