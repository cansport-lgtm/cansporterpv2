import { cn } from "@/lib/utils";

type StatusStyle = {
  label: string;
  className: string;
  dot: string;
};

const statusStyles = {
  draft: {
    label: "Draft",
    className:
      "bg-slate-100 text-slate-700 ring-slate-200/80 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700/60",
    dot: "bg-slate-400 dark:bg-slate-500",
  },
  in_progress: {
    label: "In Progress",
    className:
      "bg-blue-50 text-blue-700 ring-blue-200/80 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900/60",
    dot: "bg-blue-500",
  },
  pending: {
    label: "Pending Approval",
    className:
      "bg-amber-50 text-amber-700 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/60",
    dot: "bg-amber-500",
  },
  approved: {
    label: "Approved",
    className:
      "bg-green-50 text-green-700 ring-green-200/80 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900/60",
    dot: "bg-green-500",
  },
  rejected: {
    label: "Rejected",
    className:
      "bg-red-50 text-red-700 ring-red-200/80 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/60",
    dot: "bg-red-500",
  },
  closed: {
    label: "Closed",
    className:
      "bg-slate-100 text-slate-600 ring-slate-200/80 dark:bg-slate-800/40 dark:text-slate-400 dark:ring-slate-700/60",
    dot: "bg-slate-400 dark:bg-slate-600",
  },
} satisfies Record<string, StatusStyle>;

const aliasMap: Record<string, keyof typeof statusStyles> = {
  Draft: "draft",
  "In Progress": "in_progress",
  "Pending Approval": "pending",
  Approved: "approved",
  Rejected: "rejected",
  Closed: "closed",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const key =
    (statusStyles as Record<string, StatusStyle>)[status] !== undefined
      ? (status as keyof typeof statusStyles)
      : aliasMap[status] ?? "draft";

  const config = statusStyles[key];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset transition-colors",
        config.className,
        className
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          config.dot,
          key === "in_progress" && "animate-pulse-subtle"
        )}
        aria-hidden
      />
      {config.label}
    </span>
  );
}
