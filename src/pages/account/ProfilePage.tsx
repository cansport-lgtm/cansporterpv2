import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { MyLeaveBalanceCard } from "@/components/hr/MyLeaveBalanceCard";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const fmtRole = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (d?: string | null) => (d ? format(new Date(d), "dd MMM yyyy, hh:mm a") : "—");

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-center sm:gap-4 border-b last:border-0">
      <dt className="text-sm text-muted-foreground sm:w-44 shrink-0">{label}</dt>
      <dd className="text-sm font-medium break-words">{value || "—"}</dd>
    </div>
  );
}

export default function ProfilePage() {
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const [department, setDepartment] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.department_id) return;
    supabase
      .from("production_departments")
      .select("name")
      .eq("id", user.department_id)
      .maybeSingle()
      .then(({ data }) => setDepartment(data?.name ?? null));
  }, [user?.department_id]);

  return (
    <ERPLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 pt-6 sm:flex-row">
            <UserAvatar user={user} className="h-24 w-24 text-xl" />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h1 className="text-2xl font-semibold truncate">{user?.full_name}</h1>
              <p className="text-muted-foreground">@{user?.user_id}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                {roles.map((r) => (
                  <Badge key={r.role} variant="secondary">{fmtRole(r.role)}</Badge>
                ))}
              </div>
            </div>
            <Button variant="outline" onClick={() => navigate("/account-settings")}>
              <SettingsIcon className="mr-2 h-4 w-4" /> Edit in Settings
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Personal details</CardTitle></CardHeader>
          <CardContent>
            <dl>
              <Row label="Full name" value={user?.full_name} />
              <Row label="User ID" value={user?.user_id} />
              <Row label="Phone number" value={user?.phone} />
              <Row label="Email" value={user?.email} />
              <Row label="Designation" value={user?.designation} />
              <Row label="Department" value={department} />
            </dl>
          </CardContent>
        </Card>

        <MyLeaveBalanceCard />

        <Card>
          <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
          <CardContent>
            <dl>
              <Row
                label="Status"
                value={<Badge variant={user?.is_active ? "default" : "destructive"}>{user?.is_active ? "Active" : "Inactive"}</Badge>}
              />
              <Row label="Roles" value={roles.length ? roles.map((r) => fmtRole(r.role)).join(", ") : "—"} />
              <Row label="Last login" value={fmtDate(user?.last_login)} />
              <Row label="Member since" value={fmtDate(user?.created_at)} />
            </dl>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
