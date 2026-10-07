import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { PurchaseRequestTable, type PurchaseRequestListRow } from "@/components/purchase-request/PurchaseRequestTable";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { PR_LIST_SELECT, prDb } from "@/lib/purchaseRequest";

/**
 * Self service: the purchase requests the logged-in user raised, and — for
 * department heads — the requests of their departments waiting for them.
 */
export default function MyPurchaseRequestsPage() {
  const navigate = useNavigate();
  const { user, roles, canViewPrices } = useAuth();
  const showPrices = canViewPrices();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const [tab, setTab] = useState<"mine" | "approve">("mine");

  const { data: headDepartments = [] } = useQuery<string[]>({
    queryKey: ["purchase-request-my-head-departments", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await prDb.from("purchase_request_department_heads").select("department_id").eq("user_id", user?.id);
      if (error) throw error;
      return (data ?? []).map((r: { department_id: string }) => r.department_id);
    },
  });
  const isHead = isSuperAdmin || headDepartments.length > 0;

  const { data: mine = [], isLoading } = useQuery<PurchaseRequestListRow[]>({
    queryKey: ["purchase-requests", "mine", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await prDb
        .from("purchase_requests")
        .select(PR_LIST_SELECT)
        .eq("created_by", user?.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: toApprove = [], isLoading: approveLoading } = useQuery<PurchaseRequestListRow[]>({
    queryKey: ["purchase-requests", "hod-queue", user?.id, isSuperAdmin, headDepartments],
    enabled: isHead,
    queryFn: async () => {
      let q = prDb.from("purchase_requests").select(PR_LIST_SELECT).eq("status", "pending_hod");
      if (!isSuperAdmin) q = q.in("department_id", headDepartments);
      const { data, error } = await q.order("priority", { ascending: false }).order("submitted_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const showing = tab === "approve" && isHead ? "approve" : "mine";

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="My Purchase Requests"
          description="Ask Purchase to buy office supplies, raw material, production supplies or spares"
          icon={ClipboardList}
        >
          <Button onClick={() => navigate("/my-purchase-requests/new")}>
            <Plus className="h-4 w-4 mr-1" /> New purchase request
          </Button>
        </PageHeader>

        {isHead && (
          <Tabs value={showing} onValueChange={(v) => setTab(v as "mine" | "approve")}>
            <TabsList>
              <TabsTrigger value="mine">My requests</TabsTrigger>
              <TabsTrigger value="approve">
                To approve{toApprove.length > 0 ? ` (${toApprove.length})` : ""}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {showing === "mine" ? (
              <PurchaseRequestTable rows={mine} basePath="/my-purchase-requests" isLoading={isLoading}
                showPrices={showPrices} showRequester={false}
                emptyText="You have not raised a purchase request yet." />
            ) : (
              <PurchaseRequestTable rows={toApprove} basePath="/my-purchase-requests" isLoading={approveLoading}
                showPrices={showPrices}
                emptyText="Nothing is waiting for your approval." />
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
