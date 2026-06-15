export const DELIVERABLE_STATUSES = [
  "Draft",
  "In Progress",
  "Pending Approval",
  "Approved",
  "Rejected",
  "Published",
  "Closed",
] as const;

export const CAMPAIGN_STATUSES = [
  "Draft",
  "In Progress",
  "Pending Approval",
  "Approved",
  "Rejected",
  "Closed",
] as const;

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;

export const STATUS_COLORS: Record<string, string> = {
  "Draft": "bg-slate-100 text-slate-800 border-slate-200",
  "In Progress": "bg-amber-100 text-amber-800 border-amber-200",
  "Pending Approval": "bg-blue-100 text-blue-800 border-blue-200",
  "Approved": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Rejected": "bg-red-100 text-red-800 border-red-200",
  "Published": "bg-purple-100 text-purple-800 border-purple-200",
  "Closed": "bg-gray-100 text-gray-800 border-gray-200",
};

export const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-amber-100 text-amber-700",
  critical: "bg-red-100 text-red-700",
};
