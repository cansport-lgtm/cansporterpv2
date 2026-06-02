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
  iconColor?: string;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  description,
  className,
  iconColor = "text-primary",
}: MetricCardProps) {
  return (
    <div className={cn("metric-card group", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 min-w-0">
          <p className="metric-label">{title}</p>
          <p className="metric-value">{value}</p>
          {trend && (
            <div className="flex items-center gap-1 text-sm">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold",
                  trend.isPositive
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/70"
                    : "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200/70",
                )}
              >
                {trend.isPositive ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {trend.value}%
              </span>
              <span className="text-xs text-muted-foreground">vs last period</span>
            </div>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <div
          className={cn(
            "relative h-11 w-11 shrink-0 rounded-xl bg-brand-gradient-soft flex items-center justify-center ring-1 ring-inset ring-primary/15 transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3",
            iconColor,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
