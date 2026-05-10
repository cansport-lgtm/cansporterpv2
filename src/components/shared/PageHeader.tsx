import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LucideIcon, Plus } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconColor?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  iconColor,
  action,
  children,
}: PageHeaderProps) {
  const hasCustomIconStyle = Boolean(iconColor);

  return (
    <div className="page-header">
      <div className="flex items-center gap-4 min-w-0">
        {Icon && (
          <div
            className={cn(
              "h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center shadow-soft ring-1 ring-inset ring-border/60",
              hasCustomIconStyle
                ? iconColor
                : "bg-brand-gradient text-primary-foreground shadow-glow"
            )}
          >
            <Icon className="h-6 w-6" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="page-title truncate">{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {children}
        {action && (
          <Button onClick={action.onClick} className="shadow-soft hover:shadow-glow transition-shadow">
            {action.icon ? (
              <action.icon className="h-4 w-4 mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
