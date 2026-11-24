import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  user: { full_name?: string | null; user_id?: string | null; avatar_url?: string | null } | null;
  className?: string;
}

export function UserAvatar({ user, className }: UserAvatarProps) {
  const name = user?.full_name || user?.user_id || "U";
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <Avatar className={cn("shadow-soft", className)}>
      {user?.avatar_url && <AvatarImage src={user.avatar_url} alt={name} className="object-cover" />}
      <AvatarFallback className="bg-brand-gradient text-primary-foreground text-xs font-semibold tracking-wider">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
