import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, CheckCheck } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useNotifications, type SystemNotification } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

const TYPE_BADGES: Record<string, { label: string; className: string }> = {
  info: { label: "Info", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  success: { label: "Success", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  warning: { label: "Warning", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  error: { label: "Alert", className: "bg-red-500/10 text-red-600 border-red-500/20" },
};

export default function NotificationsPage() {
  const { notifications, unreadCount, isLoading, markRead, markAllRead } = useNotifications();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const navigate = useNavigate();

  const visible = filter === "unread" ? notifications.filter((n) => !n.is_read) : notifications;

  const handleClick = (n: SystemNotification) => {
    if (!n.is_read) void markRead(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Notifications"
          description="System notifications addressed to you"
          icon={Bell}
        >
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => void markAllRead()}>
              <CheckCheck className="h-4 w-4 mr-2" />
              Mark all read
            </Button>
          )}
        </PageHeader>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as "all" | "unread")}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">
              Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
            ) : visible.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {filter === "unread" ? "You're all caught up" : "No notifications yet"}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((n) => {
                  const badge = TYPE_BADGES[n.type] ?? TYPE_BADGES.info;
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 transition-colors",
                        n.link && "cursor-pointer hover:bg-muted/50",
                        !n.is_read && "bg-muted/30"
                      )}
                      onClick={() => handleClick(n)}
                    >
                      <div className="pt-0.5">
                        <span
                          className={cn(
                            "block h-2 w-2 rounded-full",
                            n.is_read ? "bg-border" : "bg-primary"
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("text-sm", !n.is_read ? "font-semibold" : "font-medium")}>
                            {n.title}
                          </span>
                          <Badge variant="outline" className={cn("text-[10px]", badge.className)}>
                            {badge.label}
                          </Badge>
                          {n.module && (
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {n.module.replace(/_/g, " ")}
                            </Badge>
                          )}
                        </div>
                        {n.message && (
                          <p className="mt-0.5 text-sm text-muted-foreground">{n.message}</p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground/80">
                          {format(new Date(n.created_at), "PPp")}
                        </p>
                      </div>
                      {!n.is_read && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            void markRead(n.id);
                          }}
                        >
                          Mark read
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
