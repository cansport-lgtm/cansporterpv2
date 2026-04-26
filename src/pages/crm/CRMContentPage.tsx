import { useEffect, useState, useRef } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  Image as ImageIcon,
  Video,
  FileText,
  Link as LinkIcon,
  File,
  Search,
  Trash2,
  Pencil,
  Plus,
  X,
  Megaphone,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

const ASSET_TYPES = ["image", "video", "copy", "document", "link"] as const;
const ASSET_STATUSES = ["draft", "in_review", "approved", "archived"] as const;
const CHANNELS = ["instagram", "facebook", "linkedin", "email", "whatsapp", "website", "other"] as const;
const CAMPAIGN_STATUSES = ["planned", "active", "paused", "completed"] as const;
const NONE = "none";

const ASSET_ICONS: Record<string, any> = {
  image: ImageIcon,
  video: Video,
  copy: FileText,
  document: File,
  link: LinkIcon,
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  in_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  archived: "bg-slate-200 text-slate-600",
  planned: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-purple-100 text-purple-700",
};

interface Asset {
  id: string;
  title: string;
  asset_type: string;
  file_url: string | null;
  thumbnail_url: string | null;
  external_url: string | null;
  body_text: string | null;
  tags: string[] | null;
  status: string;
  owner_id: string | null;
  notes: string | null;
  created_at: string;
}

interface Campaign {
  id: string;
  name: string;
  objective: string | null;
  channel: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  owner_id: string | null;
  linked_deal_id: string | null;
  linked_lead_id: string | null;
  notes: string | null;
}

export default function CRMContentPage() {
  const { hasModulePermission } = useAuth();
  const canCreate = hasModulePermission?.("crm", "create") ?? true;
  const canEdit = hasModulePermission?.("crm", "edit") ?? true;
  const canApprove = hasModulePermission?.("crm", "approve") ?? true;

  const [assets, setAssets] = useState<Asset[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignAssets, setCampaignAssets] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);

  // filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // asset dialog
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assetForm, setAssetForm] = useState({
    title: "",
    asset_type: "image",
    file_url: "",
    external_url: "",
    body_text: "",
    tags: "",
    status: "draft",
    owner_id: NONE,
    notes: "",
  });

  // asset side drawer
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

  // campaign dialog
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    objective: "",
    channel: "instagram",
    start_date: "",
    end_date: "",
    status: "planned",
    owner_id: NONE,
    linked_deal_id: NONE,
    linked_lead_id: NONE,
    notes: "",
  });

  // campaign drawer
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [addAssetDialogOpen, setAddAssetDialogOpen] = useState(false);
  const [assetToAdd, setAssetToAdd] = useState<string>("");

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    const [aRes, cRes, caRes, uRes, dRes, lRes] = await Promise.all([
      supabase.from("crm_content_assets").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_content_campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_content_campaign_assets").select("*").order("position"),
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
      supabase.from("crm_deals").select("id, deal_number, title").order("created_at", { ascending: false }),
      supabase.from("crm_leads").select("id, lead_number, name").order("created_at", { ascending: false }),
    ]);
    setAssets((aRes.data as any) || []);
    setCampaigns((cRes.data as any) || []);
    setCampaignAssets(caRes.data || []);
    setUsers(uRes.data || []);
    setDeals(dRes.data || []);
    setLeads(lRes.data || []);
  };

  // ---- Asset CRUD ----
  const openCreateAsset = () => {
    setEditingAsset(null);
    setAssetForm({
      title: "",
      asset_type: "image",
      file_url: "",
      external_url: "",
      body_text: "",
      tags: "",
      status: "draft",
      owner_id: NONE,
      notes: "",
    });
    setAssetDialogOpen(true);
  };

  const openEditAsset = (a: Asset) => {
    setEditingAsset(a);
    setAssetForm({
      title: a.title,
      asset_type: a.asset_type,
      file_url: a.file_url || "",
      external_url: a.external_url || "",
      body_text: a.body_text || "",
      tags: (a.tags || []).join(", "),
      status: a.status,
      owner_id: a.owner_id || NONE,
      notes: a.notes || "",
    });
    setAssetDialogOpen(true);
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("crm-content").upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from("crm-content").getPublicUrl(path);
      setAssetForm((f) => ({ ...f, file_url: data.publicUrl }));
      toast.success("File uploaded");
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSaveAsset = async () => {
    if (!assetForm.title.trim()) {
      toast.error("Title is required");
      return;
    }
    const tagsArr = assetForm.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const payload: any = {
      title: assetForm.title.trim(),
      asset_type: assetForm.asset_type,
      file_url: assetForm.file_url || null,
      external_url: assetForm.external_url || null,
      body_text: assetForm.body_text || null,
      tags: tagsArr,
      status: assetForm.status,
      owner_id: assetForm.owner_id === NONE ? null : assetForm.owner_id,
      notes: assetForm.notes || null,
    };

    // approve/archive guard
    if (
      ["approved", "archived"].includes(assetForm.status) &&
      !canApprove
    ) {
      toast.error("You don't have permission to set this status");
      return;
    }

    if (editingAsset) {
      if (!canEdit) {
        toast.error("No edit permission");
        return;
      }
      const { error } = await supabase
        .from("crm_content_assets")
        .update(payload)
        .eq("id", editingAsset.id);
      if (error) {
        toast.error("Failed to update");
        return;
      }
      toast.success("Asset updated");
    } else {
      if (!canCreate) {
        toast.error("No create permission");
        return;
      }
      const { error } = await supabase.from("crm_content_assets").insert(payload);
      if (error) {
        toast.error("Failed to create");
        return;
      }
      toast.success("Asset created");
    }
    setAssetDialogOpen(false);
    loadAll();
  };

  const handleDeleteAsset = async (id: string) => {
    if (!canApprove) {
      toast.error("No delete permission");
      return;
    }
    if (!confirm("Delete this asset?")) return;
    const { error } = await supabase.from("crm_content_assets").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Deleted");
    setPreviewAsset(null);
    loadAll();
  };

  // ---- Campaign CRUD ----
  const openCreateCampaign = () => {
    setEditingCampaign(null);
    setCampaignForm({
      name: "",
      objective: "",
      channel: "instagram",
      start_date: "",
      end_date: "",
      status: "planned",
      owner_id: NONE,
      linked_deal_id: NONE,
      linked_lead_id: NONE,
      notes: "",
    });
    setCampaignDialogOpen(true);
  };

  const openEditCampaign = (c: Campaign) => {
    setEditingCampaign(c);
    setCampaignForm({
      name: c.name,
      objective: c.objective || "",
      channel: c.channel,
      start_date: c.start_date || "",
      end_date: c.end_date || "",
      status: c.status,
      owner_id: c.owner_id || NONE,
      linked_deal_id: c.linked_deal_id || NONE,
      linked_lead_id: c.linked_lead_id || NONE,
      notes: c.notes || "",
    });
    setCampaignDialogOpen(true);
  };

  const handleSaveCampaign = async () => {
    if (!campaignForm.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload: any = {
      name: campaignForm.name.trim(),
      objective: campaignForm.objective || null,
      channel: campaignForm.channel,
      start_date: campaignForm.start_date || null,
      end_date: campaignForm.end_date || null,
      status: campaignForm.status,
      owner_id: campaignForm.owner_id === NONE ? null : campaignForm.owner_id,
      linked_deal_id: campaignForm.linked_deal_id === NONE ? null : campaignForm.linked_deal_id,
      linked_lead_id: campaignForm.linked_lead_id === NONE ? null : campaignForm.linked_lead_id,
      notes: campaignForm.notes || null,
    };
    if (editingCampaign) {
      const { error } = await supabase
        .from("crm_content_campaigns")
        .update(payload)
        .eq("id", editingCampaign.id);
      if (error) {
        toast.error("Failed to update");
        return;
      }
      toast.success("Campaign updated");
    } else {
      const { error } = await supabase.from("crm_content_campaigns").insert(payload);
      if (error) {
        toast.error("Failed to create");
        return;
      }
      toast.success("Campaign created");
    }
    setCampaignDialogOpen(false);
    loadAll();
  };

  const handleDeleteCampaign = async (id: string) => {
    if (!canApprove) {
      toast.error("No delete permission");
      return;
    }
    if (!confirm("Delete this campaign and unlink all assets?")) return;
    const { error } = await supabase.from("crm_content_campaigns").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Deleted");
    setActiveCampaign(null);
    loadAll();
  };

  // ---- Campaign-Asset link ----
  const addAssetToCampaign = async () => {
    if (!activeCampaign || !assetToAdd) return;
    const existing = campaignAssets.filter((ca) => ca.campaign_id === activeCampaign.id);
    const { error } = await supabase.from("crm_content_campaign_assets").insert({
      campaign_id: activeCampaign.id,
      asset_id: assetToAdd,
      position: existing.length,
    });
    if (error) {
      toast.error("Failed to add (maybe already linked)");
      return;
    }
    toast.success("Asset added");
    setAddAssetDialogOpen(false);
    setAssetToAdd("");
    loadAll();
  };

  const removeAssetFromCampaign = async (linkId: string) => {
    const { error } = await supabase
      .from("crm_content_campaign_assets")
      .delete()
      .eq("id", linkId);
    if (error) {
      toast.error("Failed to remove");
      return;
    }
    loadAll();
  };

  const markPublished = async (linkId: string, publishedAt: string | null) => {
    const { error } = await supabase
      .from("crm_content_campaign_assets")
      .update({ published_at: publishedAt ? null : new Date().toISOString() })
      .eq("id", linkId);
    if (error) {
      toast.error("Failed to update");
      return;
    }
    loadAll();
  };

  const updateScheduledDate = async (linkId: string, date: string) => {
    const { error } = await supabase
      .from("crm_content_campaign_assets")
      .update({ scheduled_date: date || null })
      .eq("id", linkId);
    if (error) {
      toast.error("Failed to update");
      return;
    }
    loadAll();
  };

  // ---- Filters ----
  const filteredAssets = assets.filter((a) => {
    const matchSearch =
      !search ||
      [a.title, a.body_text, ...(a.tags || [])]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(search.toLowerCase()));
    const matchType = typeFilter === "all" || a.asset_type === typeFilter;
    const matchStatus = statusFilter === "all" || a.status === statusFilter;
    return matchSearch && matchType && matchStatus;
  });

  const userName = (id: string | null) =>
    users.find((u) => u.id === id)?.full_name || "—";

  const campaignAssetCount = (campaignId: string) =>
    campaignAssets.filter((ca) => ca.campaign_id === campaignId).length;

  const linkedAssetsForCampaign = (campaignId: string) => {
    return campaignAssets
      .filter((ca) => ca.campaign_id === campaignId)
      .map((ca) => ({
        ...ca,
        asset: assets.find((a) => a.id === ca.asset_id),
      }))
      .filter((ca) => ca.asset)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Content & Creatives"
        description="Marketing asset library and campaign management"
        icon={Megaphone}
      />

      <Tabs defaultValue="assets" className="space-y-4">
        <TabsList>
          <TabsTrigger value="assets">Asset Library</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
        </TabsList>

        {/* ----- ASSET LIBRARY ----- */}
        <TabsContent value="assets" className="space-y-4">
          <Card>
            <CardContent className="p-3 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by title, copy, tag..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {ASSET_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {ASSET_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canCreate && (
                <Button onClick={openCreateAsset}>
                  <Plus className="h-4 w-4 mr-1" /> Upload Asset
                </Button>
              )}
            </CardContent>
          </Card>

          {filteredAssets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No assets found. Click "Upload Asset" to get started.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {filteredAssets.map((a) => {
                const Icon = ASSET_ICONS[a.asset_type] || File;
                const preview = a.thumbnail_url || a.file_url;
                const showImagePreview = a.asset_type === "image" && preview;
                return (
                  <Card
                    key={a.id}
                    className="cursor-pointer hover:shadow-md transition-shadow overflow-hidden"
                    onClick={() => setPreviewAsset(a)}
                  >
                    <div className="aspect-square bg-muted flex items-center justify-center relative">
                      {showImagePreview ? (
                        <img
                          src={preview!}
                          alt={a.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Icon className="h-10 w-10 text-muted-foreground" />
                      )}
                      <Badge
                        className={`absolute top-1 right-1 text-[10px] ${
                          STATUS_COLORS[a.status] || ""
                        }`}
                      >
                        {a.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="p-2">
                      <p className="text-sm font-medium truncate">{a.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {a.asset_type}
                      </p>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ----- CAMPAIGNS ----- */}
        <TabsContent value="campaigns" className="space-y-4">
          <div className="flex justify-end">
            {canCreate && (
              <Button onClick={openCreateCampaign}>
                <Plus className="h-4 w-4 mr-1" /> New Campaign
              </Button>
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead className="text-center">Assets</TableHead>
                      <TableHead>Owner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center text-muted-foreground py-8"
                        >
                          No campaigns yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      campaigns.map((c) => (
                        <TableRow
                          key={c.id}
                          className="cursor-pointer"
                          onClick={() => setActiveCampaign(c)}
                        >
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="capitalize">{c.channel}</TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLORS[c.status] || ""}>
                              {c.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {c.start_date
                              ? format(new Date(c.start_date), "dd MMM")
                              : "—"}
                            {" → "}
                            {c.end_date
                              ? format(new Date(c.end_date), "dd MMM")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            {campaignAssetCount(c.id)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {userName(c.owner_id)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== Asset upload/edit dialog ===== */}
      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAsset ? "Edit Asset" : "Upload Asset"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title *</Label>
              <Input
                value={assetForm.title}
                onChange={(e) => setAssetForm({ ...assetForm, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select
                  value={assetForm.asset_type}
                  onValueChange={(v) => setAssetForm({ ...assetForm, asset_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={assetForm.status}
                  onValueChange={(v) => setAssetForm({ ...assetForm, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {["image", "video", "document"].includes(assetForm.asset_type) && (
              <div>
                <Label>File</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="file"
                    ref={fileInputRef}
                    accept={
                      assetForm.asset_type === "image"
                        ? "image/*"
                        : assetForm.asset_type === "video"
                        ? "video/*"
                        : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                    }
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f);
                    }}
                  />
                  {uploading && (
                    <span className="text-xs text-muted-foreground">Uploading...</span>
                  )}
                </div>
                {assetForm.file_url && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    ✓ {assetForm.file_url}
                  </p>
                )}
              </div>
            )}

            {(assetForm.asset_type === "link" || assetForm.asset_type === "video") && (
              <div>
                <Label>External URL {assetForm.asset_type === "video" && "(optional)"}</Label>
                <Input
                  placeholder="https://..."
                  value={assetForm.external_url}
                  onChange={(e) =>
                    setAssetForm({ ...assetForm, external_url: e.target.value })
                  }
                />
              </div>
            )}

            {assetForm.asset_type === "copy" && (
              <div>
                <Label>Copy / Caption *</Label>
                <Textarea
                  rows={5}
                  value={assetForm.body_text}
                  onChange={(e) =>
                    setAssetForm({ ...assetForm, body_text: e.target.value })
                  }
                />
              </div>
            )}

            <div>
              <Label>Tags (comma separated)</Label>
              <Input
                placeholder="summer, sale, instagram"
                value={assetForm.tags}
                onChange={(e) => setAssetForm({ ...assetForm, tags: e.target.value })}
              />
            </div>
            <div>
              <Label>Owner</Label>
              <Select
                value={assetForm.owner_id}
                onValueChange={(v) => setAssetForm({ ...assetForm, owner_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={assetForm.notes}
                onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAsset} disabled={uploading}>
              {editingAsset ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Asset preview side drawer ===== */}
      <Sheet
        open={!!previewAsset}
        onOpenChange={(o) => !o && setPreviewAsset(null)}
      >
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{previewAsset?.title}</SheetTitle>
          </SheetHeader>
          {previewAsset && (
            <div className="space-y-4 mt-4">
              <div className="rounded border bg-muted overflow-hidden">
                {previewAsset.asset_type === "image" && previewAsset.file_url && (
                  <img
                    src={previewAsset.file_url}
                    alt={previewAsset.title}
                    className="w-full"
                  />
                )}
                {previewAsset.asset_type === "video" && previewAsset.file_url && (
                  <video src={previewAsset.file_url} controls className="w-full" />
                )}
                {previewAsset.asset_type === "video" &&
                  !previewAsset.file_url &&
                  previewAsset.external_url && (
                    <a
                      href={previewAsset.external_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block p-6 text-center text-primary underline"
                    >
                      Open video link
                    </a>
                  )}
                {previewAsset.asset_type === "copy" && (
                  <div className="p-4 whitespace-pre-wrap text-sm">
                    {previewAsset.body_text}
                  </div>
                )}
                {previewAsset.asset_type === "document" && previewAsset.file_url && (
                  <a
                    href={previewAsset.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-6 text-center text-primary underline"
                  >
                    Open document
                  </a>
                )}
                {previewAsset.asset_type === "link" && previewAsset.external_url && (
                  <a
                    href={previewAsset.external_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-6 text-center text-primary underline break-all"
                  >
                    {previewAsset.external_url}
                  </a>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <p className="capitalize">{previewAsset.asset_type}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Badge className={STATUS_COLORS[previewAsset.status] || ""}>
                    {previewAsset.status.replace("_", " ")}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Owner</Label>
                  <p>{userName(previewAsset.owner_id)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Created</Label>
                  <p>{format(new Date(previewAsset.created_at), "dd MMM yyyy")}</p>
                </div>
              </div>

              {previewAsset.tags && previewAsset.tags.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Tags</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {previewAsset.tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-xs">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {previewAsset.notes && (
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <p className="text-sm whitespace-pre-wrap">{previewAsset.notes}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      openEditAsset(previewAsset);
                      setPreviewAsset(null);
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-1" /> Edit
                  </Button>
                )}
                {canApprove && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => handleDeleteAsset(previewAsset.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ===== Campaign create/edit dialog ===== */}
      <Dialog open={campaignDialogOpen} onOpenChange={setCampaignDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCampaign ? "Edit Campaign" : "New Campaign"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input
                value={campaignForm.name}
                onChange={(e) =>
                  setCampaignForm({ ...campaignForm, name: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Objective</Label>
              <Textarea
                rows={2}
                value={campaignForm.objective}
                onChange={(e) =>
                  setCampaignForm({ ...campaignForm, objective: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Channel</Label>
                <Select
                  value={campaignForm.channel}
                  onValueChange={(v) =>
                    setCampaignForm({ ...campaignForm, channel: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={campaignForm.status}
                  onValueChange={(v) =>
                    setCampaignForm({ ...campaignForm, status: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={campaignForm.start_date}
                  onChange={(e) =>
                    setCampaignForm({ ...campaignForm, start_date: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={campaignForm.end_date}
                  onChange={(e) =>
                    setCampaignForm({ ...campaignForm, end_date: e.target.value })
                  }
                />
              </div>
            </div>
            <div>
              <Label>Owner</Label>
              <Select
                value={campaignForm.owner_id}
                onValueChange={(v) =>
                  setCampaignForm({ ...campaignForm, owner_id: v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Linked Deal</Label>
                <Select
                  value={campaignForm.linked_deal_id}
                  onValueChange={(v) =>
                    setCampaignForm({ ...campaignForm, linked_deal_id: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {deals.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.deal_number} — {d.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Linked Lead</Label>
                <Select
                  value={campaignForm.linked_lead_id}
                  onValueChange={(v) =>
                    setCampaignForm({ ...campaignForm, linked_lead_id: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {leads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.lead_number} — {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={campaignForm.notes}
                onChange={(e) =>
                  setCampaignForm({ ...campaignForm, notes: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCampaignDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCampaign}>
              {editingCampaign ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Campaign drawer ===== */}
      <Sheet
        open={!!activeCampaign}
        onOpenChange={(o) => !o && setActiveCampaign(null)}
      >
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{activeCampaign?.name}</SheetTitle>
          </SheetHeader>
          {activeCampaign && (
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">Channel</Label>
                  <p className="capitalize">{activeCampaign.channel}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Badge className={STATUS_COLORS[activeCampaign.status] || ""}>
                    {activeCampaign.status}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Start</Label>
                  <p>
                    {activeCampaign.start_date
                      ? format(new Date(activeCampaign.start_date), "dd MMM yyyy")
                      : "—"}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">End</Label>
                  <p>
                    {activeCampaign.end_date
                      ? format(new Date(activeCampaign.end_date), "dd MMM yyyy")
                      : "—"}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Owner</Label>
                  <p>{userName(activeCampaign.owner_id)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Linked Deal</Label>
                  <p>
                    {deals.find((d) => d.id === activeCampaign.linked_deal_id)
                      ?.deal_number || "—"}
                  </p>
                </div>
              </div>
              {activeCampaign.objective && (
                <div>
                  <Label className="text-xs text-muted-foreground">Objective</Label>
                  <p className="text-sm whitespace-pre-wrap">
                    {activeCampaign.objective}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between border-t pt-4">
                <h4 className="font-semibold">Linked Assets</h4>
                {canCreate && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAddAssetDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add Asset
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                {linkedAssetsForCampaign(activeCampaign.id).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No assets linked yet
                  </p>
                ) : (
                  linkedAssetsForCampaign(activeCampaign.id).map((ca) => {
                    const Icon = ASSET_ICONS[ca.asset.asset_type] || File;
                    return (
                      <div
                        key={ca.id}
                        className="flex items-center gap-2 p-2 border rounded text-sm"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{ca.asset.title}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {ca.asset.asset_type}
                          </p>
                        </div>
                        <Input
                          type="date"
                          className="w-36 h-8 text-xs"
                          value={ca.scheduled_date || ""}
                          onChange={(e) =>
                            updateScheduledDate(ca.id, e.target.value)
                          }
                          title="Scheduled date"
                        />
                        <Button
                          size="sm"
                          variant={ca.published_at ? "default" : "outline"}
                          className="h-8 text-xs"
                          onClick={() => markPublished(ca.id, ca.published_at)}
                        >
                          {ca.published_at ? "Published" : "Mark Published"}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeAssetFromCampaign(ca.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex gap-2 border-t pt-4">
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      openEditCampaign(activeCampaign);
                      setActiveCampaign(null);
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-1" /> Edit
                  </Button>
                )}
                {canApprove && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => handleDeleteCampaign(activeCampaign.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ===== Add asset to campaign dialog ===== */}
      <Dialog open={addAssetDialogOpen} onOpenChange={setAddAssetDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Asset to Campaign</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Select Asset</Label>
            <Select value={assetToAdd} onValueChange={setAssetToAdd}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an asset..." />
              </SelectTrigger>
              <SelectContent>
                {assets
                  .filter(
                    (a) =>
                      !campaignAssets.some(
                        (ca) =>
                          ca.campaign_id === activeCampaign?.id &&
                          ca.asset_id === a.id
                      )
                  )
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.title} ({a.asset_type})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddAssetDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addAssetToCampaign} disabled={!assetToAdd}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
