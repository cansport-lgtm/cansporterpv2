import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  description?: string;
  className?: string;
  /**
   * Tailwind classes for the icon chip. Accepts either:
   *   - full tinted variant: "bg-blue-100 text-blue-600"
   *   - text-only:           "text-primary" (chip falls back to soft brand tint)
   */
  iconColor?: string;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  description,
  className,
  iconColor,
}: MetricCardProps) {
  const hasCustomBg = iconColor?.includes("bg-");
  const iconChipClasses = hasCustomBg
    ? iconColor
    : cn("bg-brand-gradient-soft", iconColor ?? "text-primary");

  return (
    <div className={cn("metric-card group", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 min-w-0 flex-1">
          <p className="metric-label truncate">{title}</p>
          <p className="metric-value">{value}</p>
          {trend && (
            <div
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                trend.isPositive
                  ? "bg-green-50 text-green-700 ring-green-200/80 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900/60"
                  : "bg-red-50 text-red-700 ring-red-200/80 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/60"
              )}
            >
              {trend.isPositive ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              <span>{trend.value}%</span>
              <span className="text-muted-foreground font-normal">vs last</span>
            </div>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <div
          className={cn(
            "h-11 w-11 shrink-0 rounded-xl flex items-center justify-center ring-1 ring-inset ring-border/60 shadow-soft transition-transform duration-200 group-hover:scale-105 group-hover:-rotate-3",
            iconChipClasses
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
