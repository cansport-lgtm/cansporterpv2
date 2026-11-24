import { Search, Menu } from "lucide-react";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserMenu } from "@/components/layout/UserMenu";
import cansportLogo from "@/assets/cansport-logo.png";

interface ERPHeaderProps {
  onMenuClick: () => void;
}

export function ERPHeader({ onMenuClick }: ERPHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 pt-safe">
      <div className="flex h-14 sm:h-16 items-center justify-between gap-2 px-3 sm:px-4 lg:px-6">
        {/* Left section */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden shrink-0"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Brand mark — the sidebar (which carries the logo) is a drawer on phones */}
          <img
            src={cansportLogo}
            alt="Cansport Global Industries"
            className="h-8 w-auto object-contain lg:hidden"
          />

          {/* Search */}
          <div className="hidden md:flex items-center relative group">
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <Input
              placeholder="Search orders, products, employees..."
              className="w-80 pl-10 h-10 bg-muted/50 border-transparent placeholder:text-muted-foreground/60 focus:bg-card focus:border-input focus-visible:ring-1"
            />
            <kbd className="pointer-events-none absolute right-3 inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-card px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-70">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Right section */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Notifications */}
          <NotificationBell />

          <div className="hidden md:block h-6 w-px bg-border/80 mx-1" />

          {/* User Menu */}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
