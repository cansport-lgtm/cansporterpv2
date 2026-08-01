import { cn } from "@/lib/utils";

type Status = "draft" | "in_progress" | "pending" | "approved" | "rejected" | "closed" | "Draft" | "In Progress" | "Pending Approval" | "Approved" | "Rejected" | "Closed";

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  Draft: { label: "Draft", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  in_progress: { label: "In Progress", className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  "In Progress": { label: "In Progress", className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  pending: { label: "Pending Approval", className: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  "Pending Approval": { label: "Pending Approval", className: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  approved: { label: "Approved", className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  Approved: { label: "Approved", className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  posted: { label: "Posted", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
  Posted: { label: "Posted", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  Rejected: { label: "Rejected", className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  closed: { label: "Closed", className: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
  Closed: { label: "Closed", className: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.draft;

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
