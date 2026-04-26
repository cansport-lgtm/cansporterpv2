import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface EmployeeAvatarProps {
  name?: string | null;
  photoUrl?: string | null;
  className?: string;
}

const getInitials = (name?: string | null) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const EmployeeAvatar = ({ name, photoUrl, className }: EmployeeAvatarProps) => {
  return (
    <Avatar className={cn("h-8 w-8 border border-border", className)}>
      {photoUrl ? <AvatarImage src={photoUrl} alt={name || "Employee"} className="object-cover" /> : null}
      <AvatarFallback className="text-[10px] font-semibold bg-muted">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
};
