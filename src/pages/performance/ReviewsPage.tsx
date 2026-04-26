import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Plus, Pencil, Eye, Calendar, Filter } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const REVIEW_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "pending_review", label: "Pending Review" },
  { value: "reviewed", label: "Reviewed" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "closed", label: "Closed" },
];

const OVERALL_RATINGS = [
  "Excellent",
  "Good",
  "Satisfactory",
  "Needs Improvement",
];

const CYCLE_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed" },
];

export default function ReviewsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("reviews");
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [showCycleDialog, setShowCycleDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedReview, setSelectedReview] = useState<any>(null);
  const [selectedCycle, setSelectedCycle] = useState<any>(null);
  const [filterCycle, setFilterCycle] = useState<string>("all");
  const [employeeGoals, setEmployeeGoals] = useState<any[]>([]);

  const [reviewFormData, setReviewFormData] = useState({
    review_cycle_id: "",
    employee_id: "",
    overall_rating: "",
    strengths: "",
    areas_for_improvement: "",
    reviewer_comments: "",
    status: "draft",
  });

  const [cycleFormData, setCycleFormData] = useState({
    name: "",
    description: "",
    start_date: "",
    end_date: "",
    status: "draft",
  });

  // Fetch review cycles
  const { data: reviewCycles = [] } = useQuery({
    queryKey: ["performance-review-cycles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_review_cycles")
        .select("*")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch employees
  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_code, full_name")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch reviews
  const { data: reviews = [] } = useQuery({
    queryKey: ["performance-reviews", filterCycle],
    queryFn: async () => {
      let query = supabase
        .from("performance_reviews")
        .select(`
          *,
          performance_review_cycles(name),
          employees(employee_code, full_name),
          app_users!performance_reviews_reviewer_id_fkey(full_name)
        `)
        .order("created_at", { ascending: false });

      if (filterCycle !== "all") {
        query = query.eq("review_cycle_id", filterCycle);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Cycle mutation
  const cycleMutation = useMutation({
    mutationFn: async (data: typeof cycleFormData & { id?: string }) => {
      const payload = {
        name: data.name,
        description: data.description || null,
        start_date: data.start_date,
        end_date: data.end_date,
        status: data.status,
      };

      if (data.id) {
        const { error } = await supabase
          .from("performance_review_cycles")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("performance_review_cycles").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["performance-review-cycles"] });
      toast.success(selectedCycle ? "Cycle updated!" : "Cycle created!");
      setShowCycleDialog(false);
      resetCycleForm();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Review mutation
  const reviewMutation = useMutation({
    mutationFn: async (data: typeof reviewFormData & { id?: string }) => {
      const payload = {
        review_cycle_id: data.review_cycle_id,
        employee_id: data.employee_id,
        overall_rating: data.overall_rating || null,
        strengths: data.strengths || null,
        areas_for_improvement: data.areas_for_improvement || null,
        reviewer_comments: data.reviewer_comments || null,
        status: data.status,
        reviewed_at: data.status === "reviewed" ? new Date().toISOString() : null,
      };

      if (data.id) {
        const { error } = await supabase
          .from("performance_reviews")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("performance_reviews").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["performance-reviews"] });
      toast.success(selectedReview ? "Review updated!" : "Review created!");
      setShowReviewDialog(false);
      resetReviewForm();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const resetCycleForm = () => {
    setCycleFormData({
      name: "",
      description: "",
      start_date: "",
      end_date: "",
      status: "draft",
    });
    setSelectedCycle(null);
  };

  const resetReviewForm = () => {
    setReviewFormData({
      review_cycle_id: "",
      employee_id: "",
      overall_rating: "",
      strengths: "",
      areas_for_improvement: "",
      reviewer_comments: "",
      status: "draft",
    });
    setSelectedReview(null);
  };

  const handleEditCycle = (cycle: any) => {
    setSelectedCycle(cycle);
    setCycleFormData({
      name: cycle.name,
      description: cycle.description || "",
      start_date: cycle.start_date,
      end_date: cycle.end_date,
      status: cycle.status,
    });
    setShowCycleDialog(true);
  };

  const handleEditReview = (review: any) => {
    setSelectedReview(review);
    setReviewFormData({
      review_cycle_id: review.review_cycle_id,
      employee_id: review.employee_id,
      overall_rating: review.overall_rating || "",
      strengths: review.strengths || "",
      areas_for_improvement: review.areas_for_improvement || "",
      reviewer_comments: review.reviewer_comments || "",
      status: review.status,
    });
    setShowReviewDialog(true);
  };

  const handleViewReview = async (review: any) => {
    setSelectedReview(review);
    // Fetch employee goals for this review
    const { data: goals } = await supabase
      .from("performance_goals")
      .select(`
        *,
        performance_kpis(code, name, unit)
      `)
      .eq("review_cycle_id", review.review_cycle_id)
      .eq("employee_id", review.employee_id);
    setEmployeeGoals(goals || []);
    setShowViewDialog(true);
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "active":
      case "reviewed":
      case "acknowledged":
        return "success";
      case "closed":
      case "completed":
        return "neutral";
      case "draft":
        return "warning";
      default:
        return "neutral";
    }
  };

  const cycleColumns = [
    { key: "name", header: "Cycle Name" },
    {
      key: "period",
      header: "Period",
      render: (row: any) =>
        `${format(new Date(row.start_date), "MMM dd, yyyy")} - ${format(new Date(row.end_date), "MMM dd, yyyy")}`,
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => (
        <StatusBadge status={row.status} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <Button variant="ghost" size="icon" onClick={() => handleEditCycle(row)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const reviewColumns = [
    {
      key: "cycle",
      header: "Review Cycle",
      render: (row: any) => row.performance_review_cycles?.name || "-",
    },
    {
      key: "employee",
      header: "Employee",
      render: (row: any) => (
        <div>
          <div className="font-medium">{row.employees?.full_name}</div>
          <div className="text-xs text-muted-foreground">{row.employees?.employee_code}</div>
        </div>
      ),
    },
    {
      key: "overall_rating",
      header: "Rating",
      render: (row: any) => row.overall_rating || "-",
    },
    {
      key: "overall_score",
      header: "Score",
      render: (row: any) => (row.overall_score ? `${row.overall_score}%` : "-"),
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => (
        <StatusBadge
          status={row.status.replace(/_/g, " ")}
        />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => handleViewReview(row)}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleEditReview(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Performance Reviews"
          description="Manage review cycles and employee performance reviews"
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
            <TabsTrigger value="cycles">Review Cycles</TabsTrigger>
          </TabsList>

          <TabsContent value="reviews" className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-4 items-center">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={filterCycle} onValueChange={setFilterCycle}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All Cycles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Cycles</SelectItem>
                    {reviewCycles.map((cycle) => (
                      <SelectItem key={cycle.id} value={cycle.id}>
                        {cycle.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => { resetReviewForm(); setShowReviewDialog(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                Create Review
              </Button>
            </div>

            <DataTable
              columns={reviewColumns}
              data={reviews}
              emptyMessage="No reviews found. Create a review to get started."
            />
          </TabsContent>

          <TabsContent value="cycles" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => { resetCycleForm(); setShowCycleDialog(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                Add Cycle
              </Button>
            </div>

            <DataTable
              columns={cycleColumns}
              data={reviewCycles}
              emptyMessage="No review cycles found. Add your first cycle."
            />
          </TabsContent>
        </Tabs>

        {/* Cycle Dialog */}
        <Dialog open={showCycleDialog} onOpenChange={setShowCycleDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {selectedCycle ? "Edit Review Cycle" : "Add Review Cycle"}
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                cycleMutation.mutate({ ...cycleFormData, id: selectedCycle?.id });
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Cycle Name *</Label>
                <Input
                  value={cycleFormData.name}
                  onChange={(e) => setCycleFormData({ ...cycleFormData, name: e.target.value })}
                  placeholder="e.g., Q1 2025 Review"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={cycleFormData.description}
                  onChange={(e) => setCycleFormData({ ...cycleFormData, description: e.target.value })}
                  placeholder="Cycle description..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date *</Label>
                  <Input
                    type="date"
                    value={cycleFormData.start_date}
                    onChange={(e) => setCycleFormData({ ...cycleFormData, start_date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Date *</Label>
                  <Input
                    type="date"
                    value={cycleFormData.end_date}
                    onChange={(e) => setCycleFormData({ ...cycleFormData, end_date: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={cycleFormData.status}
                  onValueChange={(v) => setCycleFormData({ ...cycleFormData, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CYCLE_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowCycleDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={cycleMutation.isPending}>
                  {cycleMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Review Dialog */}
        <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {selectedReview ? "Edit Review" : "Create Review"}
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                reviewMutation.mutate({ ...reviewFormData, id: selectedReview?.id });
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Review Cycle *</Label>
                <Select
                  value={reviewFormData.review_cycle_id}
                  onValueChange={(v) => setReviewFormData({ ...reviewFormData, review_cycle_id: v })}
                  disabled={!!selectedReview}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cycle" />
                  </SelectTrigger>
                  <SelectContent>
                    {reviewCycles.map((cycle) => (
                      <SelectItem key={cycle.id} value={cycle.id}>
                        {cycle.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Employee *</Label>
                <Select
                  value={reviewFormData.employee_id}
                  onValueChange={(v) => setReviewFormData({ ...reviewFormData, employee_id: v })}
                  disabled={!!selectedReview}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.full_name} ({emp.employee_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Overall Rating</Label>
                  <Select
                    value={reviewFormData.overall_rating}
                    onValueChange={(v) => setReviewFormData({ ...reviewFormData, overall_rating: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select rating" />
                    </SelectTrigger>
                    <SelectContent>
                      {OVERALL_RATINGS.map((rating) => (
                        <SelectItem key={rating} value={rating}>
                          {rating}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={reviewFormData.status}
                    onValueChange={(v) => setReviewFormData({ ...reviewFormData, status: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REVIEW_STATUSES.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Strengths</Label>
                <Textarea
                  value={reviewFormData.strengths}
                  onChange={(e) => setReviewFormData({ ...reviewFormData, strengths: e.target.value })}
                  placeholder="Employee's key strengths..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Areas for Improvement</Label>
                <Textarea
                  value={reviewFormData.areas_for_improvement}
                  onChange={(e) => setReviewFormData({ ...reviewFormData, areas_for_improvement: e.target.value })}
                  placeholder="Areas that need improvement..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Reviewer Comments</Label>
                <Textarea
                  value={reviewFormData.reviewer_comments}
                  onChange={(e) => setReviewFormData({ ...reviewFormData, reviewer_comments: e.target.value })}
                  placeholder="Additional comments..."
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowReviewDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={reviewMutation.isPending}>
                  {reviewMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* View Review Dialog */}
        <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Review Details - {selectedReview?.employees?.full_name}
              </DialogTitle>
            </DialogHeader>
            {selectedReview && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Review Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Cycle:</span>
                      <p className="font-medium">{selectedReview.performance_review_cycles?.name}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Rating:</span>
                      <p className="font-medium">{selectedReview.overall_rating || "Not rated"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Score:</span>
                      <p className="font-medium">{selectedReview.overall_score ? `${selectedReview.overall_score}%` : "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status:</span>
                      <StatusBadge
                        status={selectedReview.status.replace(/_/g, " ")}
                      />
                    </div>
                  </CardContent>
                </Card>

                {employeeGoals.length > 0 && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Assigned Goals</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {employeeGoals.map((goal) => (
                          <div
                            key={goal.id}
                            className="flex items-center justify-between p-2 bg-muted/50 rounded"
                          >
                            <div>
                              <p className="font-medium text-sm">{goal.performance_kpis?.name}</p>
                              <p className="text-xs text-muted-foreground">
                                Target: {goal.target_value} {goal.performance_kpis?.unit || ""}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-medium text-sm">
                                {goal.actual_value !== null
                                  ? `${goal.actual_value} ${goal.performance_kpis?.unit || ""}`
                                  : "-"}
                              </p>
                              <StatusBadge
                                status={goal.status.replace(/_/g, " ")}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {(selectedReview.strengths || selectedReview.areas_for_improvement) && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Feedback</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {selectedReview.strengths && (
                        <div>
                          <span className="text-muted-foreground">Strengths:</span>
                          <p>{selectedReview.strengths}</p>
                        </div>
                      )}
                      {selectedReview.areas_for_improvement && (
                        <div>
                          <span className="text-muted-foreground">Areas for Improvement:</span>
                          <p>{selectedReview.areas_for_improvement}</p>
                        </div>
                      )}
                      {selectedReview.reviewer_comments && (
                        <div>
                          <span className="text-muted-foreground">Comments:</span>
                          <p>{selectedReview.reviewer_comments}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => setShowViewDialog(false)}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
