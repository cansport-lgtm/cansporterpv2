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
  return (
    <div className="page-header">
      <div className="flex items-center gap-3">
        {Icon && (
          <div
            className={cn(
              "h-10 w-10 rounded-lg flex items-center justify-center",
              iconColor || "bg-primary text-primary-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {children}
        {action && (
          <Button onClick={action.onClick}>
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
