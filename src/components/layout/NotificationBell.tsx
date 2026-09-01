import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import {
  useNotifications,
  requestDesktopNotifications,
  type SystemNotification,
} from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

const TYPE_DOT_COLORS: Record<string, string> = {
  info: "bg-blue-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

export function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();

  const handleOpen = (open: boolean) => {
    // First interaction with the bell is the natural moment to ask for
    // desktop-notification permission.
    if (open) requestDesktopNotifications();
  };

  const handleClick = (n: SystemNotification) => {
    if (!n.is_read) void markRead(n.id);
    if (n.link) navigate(n.link);
  };

  const recent = notifications.slice(0, 8);

  return (
    <DropdownMenu onOpenChange={handleOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground ring-2 ring-background">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 bg-popover shadow-popover-soft">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5">
                {unreadCount} new
              </span>
            )}
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] text-muted-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  void markAllRead();
                }}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                Mark all read
              </Button>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {recent.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className={cn(
                  "flex flex-col items-start gap-1 py-3 cursor-pointer",
                  !n.is_read && "bg-muted/40"
                )}
                onClick={() => handleClick(n)}
              >
                <div className="flex w-full items-center gap-2">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      TYPE_DOT_COLORS[n.type] ?? TYPE_DOT_COLORS.info
                    )}
                  />
                  <span className={cn("text-sm flex-1 truncate", !n.is_read ? "font-semibold" : "font-medium")}>
                    {n.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </span>
                </div>
                {n.message && (
                  <span className="text-xs text-muted-foreground pl-3.5 line-clamp-2">
                    {n.message}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-center text-primary font-medium justify-center cursor-pointer"
          onClick={() => navigate("/notifications")}
        >
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
