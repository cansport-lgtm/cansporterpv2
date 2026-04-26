import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Pencil, Briefcase, Users, Star, Medal } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// Component for Position-wise Shortlisted Candidates
function ShortlistedByPosition({ 
  candidates, 
  jobs,
  onEditCandidate 
}: { 
  candidates: any[]; 
  jobs: any[];
  onEditCandidate: (candidate: any) => void;
}) {
  // Filter shortlisted candidates only
  const shortlistedCandidates = candidates.filter(c => c.status === "shortlisted");
  
  // Group by job_posting_id
  const groupedByPosition = shortlistedCandidates.reduce((acc, candidate) => {
    const jobId = candidate.job_posting_id;
    if (!acc[jobId]) {
      acc[jobId] = [];
    }
    acc[jobId].push(candidate);
    return acc;
  }, {} as Record<string, any[]>);

  // Sort each group by rating (descending) - higher rating = better rank
  Object.keys(groupedByPosition).forEach(jobId => {
    groupedByPosition[jobId].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  });

  // Get open jobs that have shortlisted candidates
  const openJobIds = Object.keys(groupedByPosition);
  const relevantJobs = jobs.filter(j => openJobIds.includes(j.id));

  if (relevantJobs.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          No shortlisted candidates yet
        </CardContent>
      </Card>
    );
  }

  const getRankBadge = (rank: number) => {
    if (rank === 1) return <Medal className="h-5 w-5 text-amber-500" />;
    if (rank === 2) return <Medal className="h-5 w-5 text-slate-400" />;
    if (rank === 3) return <Medal className="h-5 w-5 text-amber-700" />;
    return <span className="text-muted-foreground font-medium">{rank}</span>;
  };

  return (
    <Accordion type="multiple" defaultValue={relevantJobs.map(j => j.id)} className="space-y-3">
      {relevantJobs.map(job => (
        <AccordionItem key={job.id} value={job.id} className="border rounded-lg bg-card">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-3 text-left">
              <Briefcase className="h-5 w-5 text-primary" />
              <div>
                <div className="font-semibold">{job.title}</div>
                <div className="text-sm text-muted-foreground">
                  {job.job_code} • {job.production_departments?.name || "No Department"} • {groupedByPosition[job.id]?.length || 0} shortlisted
                </div>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Experience</TableHead>
                  <TableHead>Expected Salary</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead className="w-16">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedByPosition[job.id]?.map((candidate, index) => (
                  <TableRow key={candidate.id}>
                    <TableCell className="text-center">
                      {getRankBadge(index + 1)}
                    </TableCell>
                    <TableCell className="font-medium">{candidate.candidate_name}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {candidate.email && <div>{candidate.email}</div>}
                        {candidate.phone && <div className="text-muted-foreground">{candidate.phone}</div>}
                      </div>
                    </TableCell>
                    <TableCell>{candidate.experience_years ? `${candidate.experience_years} yrs` : "-"}</TableCell>
                    <TableCell>{candidate.expected_salary ? `Rs. ${candidate.expected_salary.toLocaleString()}` : "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                        <span>{candidate.rating || 0}/5</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => onEditCandidate(candidate)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
import { useAuth } from "@/contexts/AuthContext";

const JOB_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "on_hold", label: "On Hold" },
  { value: "closed", label: "Closed" },
];

const CANDIDATE_STATUSES = [
  { value: "applied", label: "Applied" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "interview_scheduled", label: "Interview Scheduled" },
  { value: "interviewed", label: "Interviewed" },
  { value: "offered", label: "Offered" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
];

export default function RecruitmentPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("jobs");
  const [showJobDialog, setShowJobDialog] = useState(false);
  const [showCandidateDialog, setShowCandidateDialog] = useState(false);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);

  const [jobForm, setJobForm] = useState({
    title: "",
    department_id: "",
    description: "",
    requirements: "",
    positions: "1",
    salary_range_min: "",
    salary_range_max: "",
    status: "draft",
  });

  const [candidateForm, setCandidateForm] = useState({
    job_posting_id: "",
    candidate_name: "",
    email: "",
    phone: "",
    experience_years: "",
    current_salary: "",
    expected_salary: "",
    status: "applied",
    interview_notes: "",
    rating: "",
  });

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch job postings
  const { data: jobs = [] } = useQuery({
    queryKey: ["job-postings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_postings")
        .select("*, production_departments(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch candidates
  const { data: candidates = [] } = useQuery({
    queryKey: ["job-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_candidates")
        .select("*, job_postings(job_code, title)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Job mutation
  const jobMutation = useMutation({
    mutationFn: async (data: typeof jobForm & { id?: string; job_code?: string }) => {
      const payload = {
        title: data.title,
        department_id: data.department_id || null,
        description: data.description || null,
        requirements: data.requirements || null,
        positions: parseInt(data.positions) || 1,
        salary_range_min: data.salary_range_min ? parseFloat(data.salary_range_min) : null,
        salary_range_max: data.salary_range_max ? parseFloat(data.salary_range_max) : null,
        status: data.status,
        created_by: user?.id,
      };

      if (data.id) {
        const { error } = await supabase
          .from("job_postings")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { data: codeData } = await supabase.rpc("generate_job_code");
        const { error } = await supabase.from("job_postings").insert({
          ...payload,
          job_code: codeData,
          posted_date: data.status === "open" ? new Date().toISOString() : null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-postings"] });
      toast.success(selectedJob ? "Job updated!" : "Job created!");
      setShowJobDialog(false);
      resetJobForm();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Candidate mutation
  const candidateMutation = useMutation({
    mutationFn: async (data: typeof candidateForm & { id?: string }) => {
      const payload = {
        job_posting_id: data.job_posting_id,
        candidate_name: data.candidate_name,
        email: data.email || null,
        phone: data.phone || null,
        experience_years: data.experience_years ? parseFloat(data.experience_years) : null,
        current_salary: data.current_salary ? parseFloat(data.current_salary) : null,
        expected_salary: data.expected_salary ? parseFloat(data.expected_salary) : null,
        status: data.status,
        interview_notes: data.interview_notes || null,
        rating: data.rating ? parseInt(data.rating) : null,
      };

      if (data.id) {
        const { error } = await supabase
          .from("job_candidates")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("job_candidates").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-candidates"] });
      toast.success(selectedCandidate ? "Candidate updated!" : "Candidate added!");
      setShowCandidateDialog(false);
      resetCandidateForm();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const resetJobForm = () => {
    setJobForm({
      title: "",
      department_id: "",
      description: "",
      requirements: "",
      positions: "1",
      salary_range_min: "",
      salary_range_max: "",
      status: "draft",
    });
    setSelectedJob(null);
  };

  const resetCandidateForm = () => {
    setCandidateForm({
      job_posting_id: "",
      candidate_name: "",
      email: "",
      phone: "",
      experience_years: "",
      current_salary: "",
      expected_salary: "",
      status: "applied",
      interview_notes: "",
      rating: "",
    });
    setSelectedCandidate(null);
  };

  const handleEditJob = (job: any) => {
    setSelectedJob(job);
    setJobForm({
      title: job.title,
      department_id: job.department_id || "",
      description: job.description || "",
      requirements: job.requirements || "",
      positions: job.positions?.toString() || "1",
      salary_range_min: job.salary_range_min?.toString() || "",
      salary_range_max: job.salary_range_max?.toString() || "",
      status: job.status,
    });
    setShowJobDialog(true);
  };

  const handleEditCandidate = (candidate: any) => {
    setSelectedCandidate(candidate);
    setCandidateForm({
      job_posting_id: candidate.job_posting_id,
      candidate_name: candidate.candidate_name,
      email: candidate.email || "",
      phone: candidate.phone || "",
      experience_years: candidate.experience_years?.toString() || "",
      current_salary: candidate.current_salary?.toString() || "",
      expected_salary: candidate.expected_salary?.toString() || "",
      status: candidate.status,
      interview_notes: candidate.interview_notes || "",
      rating: candidate.rating?.toString() || "",
    });
    setShowCandidateDialog(true);
  };

  const jobColumns = [
    { key: "job_code", header: "Code" },
    { key: "title", header: "Title" },
    {
      key: "department",
      header: "Department",
      render: (row: any) => row.production_departments?.name || "-",
    },
    { key: "positions", header: "Positions" },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <StatusBadge status={row.status} />,
    },
    {
      key: "created_at",
      header: "Created",
      render: (row: any) => format(new Date(row.created_at), "dd MMM yyyy"),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <Button variant="ghost" size="icon" onClick={() => handleEditJob(row)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const candidateColumns = [
    { key: "candidate_name", header: "Name" },
    {
      key: "job_posting",
      header: "Applied For",
      render: (row: any) => (
        <div>
          <div className="font-medium">{row.job_postings?.title}</div>
          <div className="text-xs text-muted-foreground">{row.job_postings?.job_code}</div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      render: (row: any) => (
        <div className="text-sm">
          {row.email && <div>{row.email}</div>}
          {row.phone && <div className="text-muted-foreground">{row.phone}</div>}
        </div>
      ),
    },
    {
      key: "experience_years",
      header: "Experience",
      render: (row: any) => row.experience_years ? `${row.experience_years} yrs` : "-",
    },
    {
      key: "rating",
      header: "Rating",
      render: (row: any) => row.rating ? `${row.rating}/5` : "-",
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <Button variant="ghost" size="icon" onClick={() => handleEditCandidate(row)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const openJobs = jobs.filter(j => j.status === "open").length;
  const newApplications = candidates.filter(c => c.status === "applied").length;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Recruitment"
          description="Manage job postings and candidates"
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Briefcase className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{jobs.length}</div>
                  <div className="text-sm text-muted-foreground">Total Jobs</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <Briefcase className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{openJobs}</div>
                  <div className="text-sm text-muted-foreground">Open Positions</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Users className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{candidates.length}</div>
                  <div className="text-sm text-muted-foreground">Total Candidates</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <Users className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{newApplications}</div>
                  <div className="text-sm text-muted-foreground">New Applications</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TabsList>
              <TabsTrigger value="jobs">Job Postings</TabsTrigger>
              <TabsTrigger value="candidates">Candidates</TabsTrigger>
              <TabsTrigger value="shortlisted">Shortlisted</TabsTrigger>
            </TabsList>
            {activeTab === "jobs" ? (
              <Button onClick={() => { resetJobForm(); setShowJobDialog(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                Add Job
              </Button>
            ) : activeTab === "candidates" ? (
              <Button onClick={() => { resetCandidateForm(); setShowCandidateDialog(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                Add Candidate
              </Button>
            ) : null}
          </div>

          <TabsContent value="jobs" className="mt-4">
            <DataTable
              columns={jobColumns}
              data={jobs}
              emptyMessage="No job postings yet"
            />
          </TabsContent>

          <TabsContent value="candidates" className="mt-4">
            <DataTable
              columns={candidateColumns}
              data={candidates}
              emptyMessage="No candidates yet"
            />
          </TabsContent>

          <TabsContent value="shortlisted" className="mt-4">
            <ShortlistedByPosition candidates={candidates} jobs={jobs} onEditCandidate={handleEditCandidate} />
          </TabsContent>
        </Tabs>

        {/* Job Dialog */}
        <Dialog open={showJobDialog} onOpenChange={setShowJobDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedJob ? "Edit Job Posting" : "New Job Posting"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); jobMutation.mutate({ ...jobForm, id: selectedJob?.id }); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Job Title *</Label>
                <Input
                  value={jobForm.title}
                  onChange={(e) => setJobForm({ ...jobForm, title: e.target.value })}
                  placeholder="e.g., Production Supervisor"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Select
                    value={jobForm.department_id}
                    onValueChange={(v) => setJobForm({ ...jobForm, department_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Positions</Label>
                  <Input
                    type="number"
                    min="1"
                    value={jobForm.positions}
                    onChange={(e) => setJobForm({ ...jobForm, positions: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={jobForm.description}
                  onChange={(e) => setJobForm({ ...jobForm, description: e.target.value })}
                  placeholder="Job description..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Requirements</Label>
                <Textarea
                  value={jobForm.requirements}
                  onChange={(e) => setJobForm({ ...jobForm, requirements: e.target.value })}
                  placeholder="Qualifications required..."
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Salary Min</Label>
                  <Input
                    type="number"
                    value={jobForm.salary_range_min}
                    onChange={(e) => setJobForm({ ...jobForm, salary_range_min: e.target.value })}
                    placeholder="Min"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Salary Max</Label>
                  <Input
                    type="number"
                    value={jobForm.salary_range_max}
                    onChange={(e) => setJobForm({ ...jobForm, salary_range_max: e.target.value })}
                    placeholder="Max"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={jobForm.status}
                  onValueChange={(v) => setJobForm({ ...jobForm, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowJobDialog(false)}>Cancel</Button>
                <Button type="submit" disabled={jobMutation.isPending}>
                  {jobMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Candidate Dialog */}
        <Dialog open={showCandidateDialog} onOpenChange={setShowCandidateDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedCandidate ? "Edit Candidate" : "Add Candidate"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); candidateMutation.mutate({ ...candidateForm, id: selectedCandidate?.id }); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Job Position *</Label>
                <Select
                  value={candidateForm.job_posting_id}
                  onValueChange={(v) => setCandidateForm({ ...candidateForm, job_posting_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select job" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs.filter(j => j.status === "open").map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.title} ({j.job_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Candidate Name *</Label>
                <Input
                  value={candidateForm.candidate_name}
                  onChange={(e) => setCandidateForm({ ...candidateForm, candidate_name: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={candidateForm.email}
                    onChange={(e) => setCandidateForm({ ...candidateForm, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={candidateForm.phone}
                    onChange={(e) => setCandidateForm({ ...candidateForm, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Experience (yrs)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={candidateForm.experience_years}
                    onChange={(e) => setCandidateForm({ ...candidateForm, experience_years: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Current Salary</Label>
                  <Input
                    type="number"
                    value={candidateForm.current_salary}
                    onChange={(e) => setCandidateForm({ ...candidateForm, current_salary: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Expected Salary</Label>
                  <Input
                    type="number"
                    value={candidateForm.expected_salary}
                    onChange={(e) => setCandidateForm({ ...candidateForm, expected_salary: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={candidateForm.status}
                    onValueChange={(v) => setCandidateForm({ ...candidateForm, status: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CANDIDATE_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Rating (1-5)</Label>
                  <Select
                    value={candidateForm.rating}
                    onValueChange={(v) => setCandidateForm({ ...candidateForm, rating: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Rate" />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Interview Notes</Label>
                <Textarea
                  value={candidateForm.interview_notes}
                  onChange={(e) => setCandidateForm({ ...candidateForm, interview_notes: e.target.value })}
                  placeholder="Notes from interview..."
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowCandidateDialog(false)}>Cancel</Button>
                <Button type="submit" disabled={candidateMutation.isPending}>
                  {candidateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
