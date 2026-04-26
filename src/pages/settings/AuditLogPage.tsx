import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Search, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AuditLogEntry {
  id: string;
  user_id: string | null;
  module: string;
  action: string;
  record_type: string | null;
  record_id: string | null;
  old_values: any;
  new_values: any;
  ip_address: string | null;
  created_at: string | null;
  user_name?: string;
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const { toast } = useToast();

  useEffect(() => {
    const fetchLogs = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("audit_log")
          .select(`
            *,
            app_users!audit_log_user_id_fkey (full_name)
          `)
          .order("created_at", { ascending: false })
          .limit(100);

        if (error) throw error;

        const logsWithUserNames = (data || []).map((log) => ({
          ...log,
          user_name: log.app_users?.full_name || "System",
        }));

        setLogs(logsWithUserNames);
      } catch (error) {
        console.error("Error fetching audit logs:", error);
        toast({
          title: "Error",
          description: "Failed to fetch audit logs",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchLogs();
  }, []);

  const getActionStatus = (action: string): "draft" | "in_progress" | "pending" | "approved" | "rejected" | "closed" => {
    switch (action.toLowerCase()) {
      case "create":
        return "approved";
      case "update":
        return "in_progress";
      case "delete":
        return "rejected";
      case "approve":
        return "approved";
      case "login":
        return "in_progress";
      default:
        return "draft";
    }
  };

  const uniqueModules = [...new Set(logs.map((log) => log.module))];
  const uniqueActions = [...new Set(logs.map((log) => log.action))];

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.module.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesModule = moduleFilter === "all" || log.module === moduleFilter;
    const matchesAction = actionFilter === "all" || log.action === actionFilter;
    return matchesSearch && matchesModule && matchesAction;
  });

  const columns = [
    {
      key: "created_at",
      header: "Timestamp",
      render: (item: AuditLogEntry) =>
        item.created_at ? new Date(item.created_at).toLocaleString() : "-",
    },
    { key: "user_name", header: "User" },
    { key: "module", header: "Module" },
    {
      key: "action",
      header: "Action",
      render: (item: AuditLogEntry) => (
        <StatusBadge status={getActionStatus(item.action)} />
      ),
    },
    { key: "record_type", header: "Record Type" },
    {
      key: "record_id",
      header: "Record ID",
      render: (item: AuditLogEntry) =>
        item.record_id ? item.record_id.substring(0, 8) + "..." : "-",
    },
    { key: "ip_address", header: "IP Address" },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Audit Log"
        description="Track all system activities and changes"
        icon={FileText}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-full sm:w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              {uniqueModules.map((module) => (
                <SelectItem key={module} value={module}>
                  {module}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {uniqueActions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={columns}
          data={filteredLogs}
          emptyMessage={isLoading ? "Loading..." : "No audit logs found"}
        />
      </div>
    </ERPLayout>
  );
}