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
    <div className={cn("metric-card", className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="metric-label">{title}</p>
          <p className="metric-value">{value}</p>
          {trend && (
            <div className="flex items-center gap-1 text-sm">
              {trend.isPositive ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <span
                className={cn(
                  trend.isPositive ? "text-green-600" : "text-red-600"
                )}
              >
                {trend.value}%
              </span>
              <span className="text-muted-foreground">vs last period</span>
            </div>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <div
          className={cn(
            "h-11 w-11 rounded-xl flex items-center justify-center bg-primary/10",
            iconColor
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
