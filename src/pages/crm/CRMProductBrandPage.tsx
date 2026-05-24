import { useEffect, useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Package, Plus, Pencil, Trash2, Trophy, Megaphone, Sparkles, Boxes, ChevronRight, Paperclip, X, Upload, FileText, GanttChart, ChevronLeft } from "lucide-react";
import { format, addMonths, startOfMonth, endOfMonth, differenceInDays, parseISO, max as dateMax, min as dateMin } from "date-fns";
import { Slider } from "@/components/ui/slider";

type Product = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  sku_prefix: string | null;
  description: string | null;
  hero_image_url: string | null;
  status: string;
  tags: string[] | null;
};

type Variant = {
  id: string;
  product_id: string;
  variant_name: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  mrp: number | null;
  status: string;
};

type Packaging = {
  id: string;
  product_id: string;
  pack_type: string;
  units_per_pack: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  weight_g: number | null;
  barcode: string | null;
  image_url: string | null;
};

type Positioning = {
  id?: string;
  product_id: string;
  tagline: string | null;
  target_segment: string | null;
  value_proposition: string | null;
  brand_pillars: string[] | null;
  tone_of_voice: string | null;
  key_messaging: string | null;
  usps: string[] | null;
};

type Competitor = {
  id: string;
  product_id: string;
  competitor_name: string;
  logo_url: string | null;
  source_url: string | null;
  sort_order: number;
};

type Attribute = {
  id: string;
  product_id: string;
  attribute_name: string;
  sort_order: number;
};

type CompValue = {
  id: string;
  attribute_id: string;
  competitor_id: string | null;
  value: string | null;
};

type LaunchPlan = {
  id: string;
  product_id: string;
  name: string;
  launch_date: string | null;
  status: string;
  owner: string | null;
  channels: string[] | null;
  budget: number | null;
  notes: string | null;
};

type MilestoneAttachment = {
  url: string;
  name: string;
  type: string;
  size: number;
  path: string;
  uploaded_at: string;
};

type Milestone = {
  id: string;
  plan_id: string;
  title: string;
  due_date: string | null;
  owner: string | null;
  status: string;
  sort_order: number;
  notes: string | null;
  attachments: MilestoneAttachment[];
};

const PRODUCT_STATUSES = ["Draft", "Active", "Discontinued"];
const VARIANT_STATUSES = ["Active", "Inactive"];
const PLAN_STATUSES = ["Planned", "In Progress", "Launched", "On Hold"];
const MILESTONE_STATUSES = ["Pending", "In Progress", "Done"];

const STATUS_COLOR: Record<string, string> = {
  Draft: "bg-slate-200 text-slate-700",
  Active: "bg-green-100 text-green-700",
  Discontinued: "bg-rose-100 text-rose-700",
  Planned: "bg-blue-100 text-blue-700",
  "In Progress": "bg-amber-100 text-amber-700",
  Launched: "bg-green-100 text-green-700",
  "On Hold": "bg-slate-200 text-slate-700",
  Pending: "bg-slate-200 text-slate-700",
  Done: "bg-green-100 text-green-700",
  Inactive: "bg-slate-200 text-slate-700",
};

export default function CRMProductBrandPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState("products");

  // Product dialog
  const [productDlg, setProductDlg] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);

  const loadProducts = async () => {
    const { data, error } = await supabase
      .from("crm_products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    setProducts((data || []) as Product[]);
    if (!selectedId && data && data.length) setSelectedId(data[0].id);
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const selected = useMemo(() => products.find((p) => p.id === selectedId) || null, [products, selectedId]);

  const saveProduct = async () => {
    if (!editingProduct?.name) return toast.error("Name required");
    const payload = {
      name: editingProduct.name,
      brand: editingProduct.brand || null,
      category: editingProduct.category || null,
      sku_prefix: editingProduct.sku_prefix || null,
      description: editingProduct.description || null,
      hero_image_url: editingProduct.hero_image_url || null,
      status: editingProduct.status || "Draft",
      tags: typeof editingProduct.tags === "string"
        ? (editingProduct.tags as unknown as string).split(",").map((t) => t.trim()).filter(Boolean)
        : editingProduct.tags || [],
    };
    const q = editingProduct.id
      ? supabase.from("crm_products").update(payload).eq("id", editingProduct.id)
      : supabase.from("crm_products").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setProductDlg(false);
    setEditingProduct(null);
    loadProducts();
  };

  const deleteProduct = async (id: string) => {
    if (!confirm("Delete this product and all its variants, packaging, etc.?")) return;
    const { error } = await supabase.from("crm_products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    if (selectedId === id) setSelectedId(null);
    loadProducts();
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Product & Brand Management"
        description="Variants, packaging, brand positioning, competitor analysis & launch plans"
        icon={Package}
        iconColor="bg-fuchsia-500 text-white"
        action={{
          label: "New Product",
          onClick: () => {
            setEditingProduct({ status: "Draft" });
            setProductDlg(true);
          },
        }}
      />

      <div className="px-4 md:px-6 pb-6">
        {/* Product picker bar (visible on non-products tabs) */}
        {tab !== "products" && (
          <Card className="mb-4">
            <CardContent className="p-3 flex items-center gap-3 flex-wrap">
              <Label className="text-xs text-muted-foreground">Product:</Label>
              <Select value={selectedId || ""} onValueChange={(v) => setSelectedId(v)}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.brand ? `· ${p.brand}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && (
                <Badge className={STATUS_COLOR[selected.status] || ""}>{selected.status}</Badge>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-2 md:grid-cols-6 h-auto">
            <TabsTrigger value="products"><Boxes className="h-4 w-4 mr-1.5" />Products</TabsTrigger>
            <TabsTrigger value="variants"><Package className="h-4 w-4 mr-1.5" />Variants & Packaging</TabsTrigger>
            <TabsTrigger value="positioning"><Sparkles className="h-4 w-4 mr-1.5" />Positioning</TabsTrigger>
            <TabsTrigger value="competitors"><Trophy className="h-4 w-4 mr-1.5" />Competitors</TabsTrigger>
            <TabsTrigger value="launch"><Megaphone className="h-4 w-4 mr-1.5" />Launch Plans</TabsTrigger>
            <TabsTrigger value="roadmap"><GanttChart className="h-4 w-4 mr-1.5" />Roadmap</TabsTrigger>
          </TabsList>

          <TabsContent value="products" className="mt-4">
            <ProductsTab
              products={products}
              onEdit={(p) => { setEditingProduct(p); setProductDlg(true); }}
              onDelete={deleteProduct}
              onSelect={(id) => { setSelectedId(id); setTab("variants"); }}
            />
          </TabsContent>

          <TabsContent value="variants" className="mt-4">
            {selected ? <VariantsPackagingTab product={selected} /> : <EmptyPick />}
          </TabsContent>
          <TabsContent value="positioning" className="mt-4">
            {selected ? <PositioningTab product={selected} /> : <EmptyPick />}
          </TabsContent>
          <TabsContent value="competitors" className="mt-4">
            {selected ? <CompetitorsTab product={selected} /> : <EmptyPick />}
          </TabsContent>
          <TabsContent value="launch" className="mt-4">
            {selected ? <LaunchTab product={selected} /> : <EmptyPick />}
          </TabsContent>
          <TabsContent value="roadmap" className="mt-4">
            <RoadmapTab products={products} selectedProductId={selectedId} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Product Dialog */}
      <Dialog open={productDlg} onOpenChange={setProductDlg}>
        <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProduct?.id ? "Edit Product" : "New Product"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name *">
              <Input value={editingProduct?.name || ""} onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })} />
            </Field>
            <Field label="Brand">
              <Input value={editingProduct?.brand || ""} onChange={(e) => setEditingProduct({ ...editingProduct, brand: e.target.value })} />
            </Field>
            <Field label="Category">
              <Input value={editingProduct?.category || ""} onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })} />
            </Field>
            <Field label="SKU Prefix">
              <Input value={editingProduct?.sku_prefix || ""} onChange={(e) => setEditingProduct({ ...editingProduct, sku_prefix: e.target.value })} />
            </Field>
            <Field label="Status">
              <Select value={editingProduct?.status || "Draft"} onValueChange={(v) => setEditingProduct({ ...editingProduct, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Hero Image URL">
              <Input value={editingProduct?.hero_image_url || ""} onChange={(e) => setEditingProduct({ ...editingProduct, hero_image_url: e.target.value })} />
            </Field>
            <Field label="Tags (comma separated)" className="md:col-span-2">
              <Input
                value={Array.isArray(editingProduct?.tags) ? (editingProduct?.tags as string[]).join(", ") : (editingProduct?.tags as unknown as string) || ""}
                onChange={(e) => setEditingProduct({ ...editingProduct, tags: e.target.value as unknown as string[] })}
              />
            </Field>
            <Field label="Description" className="md:col-span-2">
              <Textarea rows={3} value={editingProduct?.description || ""} onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductDlg(false)}>Cancel</Button>
            <Button onClick={saveProduct}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function EmptyPick() {
  return (
    <Card><CardContent className="p-8 text-center text-muted-foreground">Select or create a product first.</CardContent></Card>
  );
}

/* -------- Products tab -------- */
function ProductsTab({
  products, onEdit, onDelete, onSelect,
}: {
  products: Product[];
  onEdit: (p: Product) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  if (!products.length) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground">No products yet. Click "New Product" to get started.</CardContent></Card>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {products.map((p) => (
        <Card key={p.id} className="overflow-hidden hover:shadow-md transition">
          {p.hero_image_url && (
            <div className="aspect-video bg-muted">
              <img src={p.hero_image_url} alt={p.name} className="w-full h-full object-cover" />
            </div>
          )}
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{p.name}</h3>
                {p.brand && <p className="text-xs text-muted-foreground">{p.brand}{p.category ? ` · ${p.category}` : ""}</p>}
              </div>
              <Badge className={STATUS_COLOR[p.status] || ""}>{p.status}</Badge>
            </div>
            {p.description && <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>}
            {p.tags && p.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.tags.slice(0, 4).map((t) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={() => onSelect(p.id)} className="flex-1">
                Open <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onEdit(p)}><Pencil className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(p.id)}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* -------- Variants & Packaging -------- */
function VariantsPackagingTab({ product }: { product: Product }) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [packs, setPacks] = useState<Packaging[]>([]);
  const [vDlg, setVDlg] = useState(false);
  const [vEdit, setVEdit] = useState<Partial<Variant> | null>(null);
  const [pDlg, setPDlg] = useState(false);
  const [pEdit, setPEdit] = useState<Partial<Packaging> | null>(null);

  const load = async () => {
    const [v, p] = await Promise.all([
      supabase.from("crm_product_variants").select("*").eq("product_id", product.id).order("created_at"),
      supabase.from("crm_product_packaging").select("*").eq("product_id", product.id).order("created_at"),
    ]);
    setVariants((v.data || []) as Variant[]);
    setPacks((p.data || []) as Packaging[]);
  };
  useEffect(() => { load(); }, [product.id]);

  const saveV = async () => {
    if (!vEdit?.variant_name) return toast.error("Variant name required");
    const payload = {
      product_id: product.id,
      variant_name: vEdit.variant_name,
      sku: vEdit.sku || null,
      color: vEdit.color || null,
      size: vEdit.size || null,
      mrp: vEdit.mrp ?? null,
      status: vEdit.status || "Active",
    };
    const q = vEdit.id
      ? supabase.from("crm_product_variants").update(payload).eq("id", vEdit.id)
      : supabase.from("crm_product_variants").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setVDlg(false); setVEdit(null); load();
  };
  const delV = async (id: string) => {
    if (!confirm("Delete variant?")) return;
    await supabase.from("crm_product_variants").delete().eq("id", id);
    load();
  };

  const saveP = async () => {
    if (!pEdit?.pack_type) return toast.error("Pack type required");
    const payload = {
      product_id: product.id,
      pack_type: pEdit.pack_type,
      units_per_pack: pEdit.units_per_pack ?? null,
      length_cm: pEdit.length_cm ?? null,
      width_cm: pEdit.width_cm ?? null,
      height_cm: pEdit.height_cm ?? null,
      weight_g: pEdit.weight_g ?? null,
      barcode: pEdit.barcode || null,
      image_url: pEdit.image_url || null,
    };
    const q = pEdit.id
      ? supabase.from("crm_product_packaging").update(payload).eq("id", pEdit.id)
      : supabase.from("crm_product_packaging").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setPDlg(false); setPEdit(null); load();
  };
  const delP = async (id: string) => {
    if (!confirm("Delete packaging?")) return;
    await supabase.from("crm_product_packaging").delete().eq("id", id);
    load();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-4">
          <CardTitle className="text-base">Variants</CardTitle>
          <Button size="sm" onClick={() => { setVEdit({ status: "Active" }); setVDlg(true); }}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Variant</TableHead><TableHead>SKU</TableHead><TableHead>Color</TableHead>
              <TableHead>Size</TableHead><TableHead>MRP</TableHead><TableHead>Status</TableHead><TableHead className="w-24"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {variants.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No variants</TableCell></TableRow>
              ) : variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.variant_name}</TableCell>
                  <TableCell>{v.sku || "-"}</TableCell>
                  <TableCell>{v.color || "-"}</TableCell>
                  <TableCell>{v.size || "-"}</TableCell>
                  <TableCell>{v.mrp != null ? `Rs. ${Number(v.mrp).toLocaleString()}` : "-"}</TableCell>
                  <TableCell><Badge className={STATUS_COLOR[v.status]}>{v.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setVEdit(v); setVDlg(true); }}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => delV(v.id)}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-4">
          <CardTitle className="text-base">Packaging</CardTitle>
          <Button size="sm" onClick={() => { setPEdit({}); setPDlg(true); }}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Pack Type</TableHead><TableHead>Units / Pack</TableHead>
              <TableHead>L × W × H (cm)</TableHead><TableHead>Weight (g)</TableHead>
              <TableHead>Barcode</TableHead><TableHead className="w-24"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {packs.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No packaging</TableCell></TableRow>
              ) : packs.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.pack_type}</TableCell>
                  <TableCell>{p.units_per_pack ?? "-"}</TableCell>
                  <TableCell>{[p.length_cm, p.width_cm, p.height_cm].map((x) => x ?? "-").join(" × ")}</TableCell>
                  <TableCell>{p.weight_g ?? "-"}</TableCell>
                  <TableCell>{p.barcode || "-"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setPEdit(p); setPDlg(true); }}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => delP(p.id)}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Variant dialog */}
      <Dialog open={vDlg} onOpenChange={setVDlg}>
        <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{vEdit?.id ? "Edit" : "New"} Variant</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Variant Name *" className="col-span-2"><Input value={vEdit?.variant_name || ""} onChange={(e) => setVEdit({ ...vEdit, variant_name: e.target.value })} /></Field>
            <Field label="SKU"><Input value={vEdit?.sku || ""} onChange={(e) => setVEdit({ ...vEdit, sku: e.target.value })} /></Field>
            <Field label="MRP (Rs.)"><Input type="number" value={vEdit?.mrp ?? ""} onChange={(e) => setVEdit({ ...vEdit, mrp: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Color"><Input value={vEdit?.color || ""} onChange={(e) => setVEdit({ ...vEdit, color: e.target.value })} /></Field>
            <Field label="Size"><Input value={vEdit?.size || ""} onChange={(e) => setVEdit({ ...vEdit, size: e.target.value })} /></Field>
            <Field label="Status" className="col-span-2">
              <Select value={vEdit?.status || "Active"} onValueChange={(v) => setVEdit({ ...vEdit, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{VARIANT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVDlg(false)}>Cancel</Button>
            <Button onClick={saveV}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Packaging dialog */}
      <Dialog open={pDlg} onOpenChange={setPDlg}>
        <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{pEdit?.id ? "Edit" : "New"} Packaging</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pack Type *" className="col-span-2"><Input value={pEdit?.pack_type || ""} onChange={(e) => setPEdit({ ...pEdit, pack_type: e.target.value })} placeholder="Box / Poly / Tin..." /></Field>
            <Field label="Units / Pack"><Input type="number" value={pEdit?.units_per_pack ?? ""} onChange={(e) => setPEdit({ ...pEdit, units_per_pack: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Weight (g)"><Input type="number" value={pEdit?.weight_g ?? ""} onChange={(e) => setPEdit({ ...pEdit, weight_g: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Length (cm)"><Input type="number" value={pEdit?.length_cm ?? ""} onChange={(e) => setPEdit({ ...pEdit, length_cm: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Width (cm)"><Input type="number" value={pEdit?.width_cm ?? ""} onChange={(e) => setPEdit({ ...pEdit, width_cm: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Height (cm)"><Input type="number" value={pEdit?.height_cm ?? ""} onChange={(e) => setPEdit({ ...pEdit, height_cm: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Barcode"><Input value={pEdit?.barcode || ""} onChange={(e) => setPEdit({ ...pEdit, barcode: e.target.value })} /></Field>
            <Field label="Image URL" className="col-span-2"><Input value={pEdit?.image_url || ""} onChange={(e) => setPEdit({ ...pEdit, image_url: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPDlg(false)}>Cancel</Button>
            <Button onClick={saveP}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------- Positioning -------- */
function PositioningTab({ product }: { product: Product }) {
  const [pos, setPos] = useState<Positioning>({
    product_id: product.id, tagline: "", target_segment: "", value_proposition: "",
    brand_pillars: [], tone_of_voice: "", key_messaging: "", usps: [],
  });
  const [pillarsStr, setPillarsStr] = useState("");
  const [uspsStr, setUspsStr] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("crm_brand_positioning").select("*").eq("product_id", product.id).maybeSingle();
      if (data) {
        setPos(data as Positioning);
        setPillarsStr((data.brand_pillars || []).join(", "));
        setUspsStr((data.usps || []).join("\n"));
      } else {
        setPos({ product_id: product.id, tagline: "", target_segment: "", value_proposition: "", brand_pillars: [], tone_of_voice: "", key_messaging: "", usps: [] });
        setPillarsStr(""); setUspsStr("");
      }
    })();
  }, [product.id]);

  const save = async () => {
    const payload = {
      product_id: product.id,
      tagline: pos.tagline || null,
      target_segment: pos.target_segment || null,
      value_proposition: pos.value_proposition || null,
      brand_pillars: pillarsStr.split(",").map((s) => s.trim()).filter(Boolean),
      tone_of_voice: pos.tone_of_voice || null,
      key_messaging: pos.key_messaging || null,
      usps: uspsStr.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    const q = pos.id
      ? supabase.from("crm_brand_positioning").update(payload).eq("id", pos.id)
      : supabase.from("crm_brand_positioning").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Saved");
    const { data } = await supabase.from("crm_brand_positioning").select("*").eq("product_id", product.id).maybeSingle();
    if (data) setPos(data as Positioning);
  };

  return (
    <Card>
      <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Tagline" className="md:col-span-2"><Input value={pos.tagline || ""} onChange={(e) => setPos({ ...pos, tagline: e.target.value })} /></Field>
        <Field label="Target Segment"><Input value={pos.target_segment || ""} onChange={(e) => setPos({ ...pos, target_segment: e.target.value })} /></Field>
        <Field label="Tone of Voice"><Input value={pos.tone_of_voice || ""} onChange={(e) => setPos({ ...pos, tone_of_voice: e.target.value })} /></Field>
        <Field label="Value Proposition" className="md:col-span-2"><Textarea rows={3} value={pos.value_proposition || ""} onChange={(e) => setPos({ ...pos, value_proposition: e.target.value })} /></Field>
        <Field label="Brand Pillars (comma separated)" className="md:col-span-2"><Input value={pillarsStr} onChange={(e) => setPillarsStr(e.target.value)} /></Field>
        <Field label="Key Messaging" className="md:col-span-2"><Textarea rows={3} value={pos.key_messaging || ""} onChange={(e) => setPos({ ...pos, key_messaging: e.target.value })} /></Field>
        <Field label="USPs (one per line)" className="md:col-span-2"><Textarea rows={4} value={uspsStr} onChange={(e) => setUspsStr(e.target.value)} /></Field>
        <div className="md:col-span-2 flex justify-end">
          <Button onClick={save}>Save Positioning</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------- Competitors (feature matrix) -------- */
function CompetitorsTab({ product }: { product: Product }) {
  const [comps, setComps] = useState<Competitor[]>([]);
  const [attrs, setAttrs] = useState<Attribute[]>([]);
  const [vals, setVals] = useState<CompValue[]>([]);
  const [newAttr, setNewAttr] = useState("");
  const [newComp, setNewComp] = useState("");

  const load = async () => {
    const [c, a] = await Promise.all([
      supabase.from("crm_competitors").select("*").eq("product_id", product.id).order("sort_order"),
      supabase.from("crm_competitor_attributes").select("*").eq("product_id", product.id).order("sort_order"),
    ]);
    const competitors = (c.data || []) as Competitor[];
    const attributes = (a.data || []) as Attribute[];
    setComps(competitors);
    setAttrs(attributes);
    if (attributes.length) {
      const { data: v } = await supabase
        .from("crm_competitor_values").select("*")
        .in("attribute_id", attributes.map((x) => x.id));
      setVals((v || []) as CompValue[]);
    } else {
      setVals([]);
    }
  };
  useEffect(() => { load(); }, [product.id]);

  const addAttr = async () => {
    if (!newAttr.trim()) return;
    const { error } = await supabase.from("crm_competitor_attributes").insert({
      product_id: product.id, attribute_name: newAttr.trim(), sort_order: attrs.length,
    });
    if (error) return toast.error(error.message);
    setNewAttr(""); load();
  };
  const addComp = async () => {
    if (!newComp.trim()) return;
    const { error } = await supabase.from("crm_competitors").insert({
      product_id: product.id, competitor_name: newComp.trim(), sort_order: comps.length,
    });
    if (error) return toast.error(error.message);
    setNewComp(""); load();
  };
  const delAttr = async (id: string) => { await supabase.from("crm_competitor_attributes").delete().eq("id", id); load(); };
  const delComp = async (id: string) => { await supabase.from("crm_competitors").delete().eq("id", id); load(); };

  const findVal = (attrId: string, compId: string | null) =>
    vals.find((x) => x.attribute_id === attrId && (x.competitor_id || null) === compId);

  const setVal = async (attrId: string, compId: string | null, value: string) => {
    const existing = findVal(attrId, compId);
    if (existing) {
      await supabase.from("crm_competitor_values").update({ value }).eq("id", existing.id);
      setVals(vals.map((x) => x.id === existing.id ? { ...x, value } : x));
    } else {
      const { data } = await supabase.from("crm_competitor_values")
        .insert({ attribute_id: attrId, competitor_id: compId, value })
        .select().single();
      if (data) setVals([...vals, data as CompValue]);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 flex flex-col md:flex-row gap-2">
          <div className="flex gap-2 flex-1">
            <Input placeholder="Add attribute (e.g. Price, Weight, Material)" value={newAttr} onChange={(e) => setNewAttr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAttr()} />
            <Button onClick={addAttr}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex gap-2 flex-1">
            <Input placeholder="Add competitor name" value={newComp} onChange={(e) => setNewComp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComp()} />
            <Button onClick={addComp}><Plus className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      {attrs.length === 0 || comps.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Add attributes and competitors above to build the comparison matrix.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[160px]">Attribute</TableHead>
                  <TableHead className="bg-fuchsia-50 font-semibold">{product.name} (Ours)</TableHead>
                  {comps.map((c) => (
                    <TableHead key={c.id}>
                      <div className="flex items-center gap-1">
                        <span>{c.competitor_name}</span>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => delComp(c.id)}><Trash2 className="h-3 w-3 text-rose-500" /></Button>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {attrs.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1">
                        <span>{a.attribute_name}</span>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => delAttr(a.id)}><Trash2 className="h-3 w-3 text-rose-500" /></Button>
                      </div>
                    </TableCell>
                    <TableCell className="bg-fuchsia-50/50">
                      <Input
                        defaultValue={findVal(a.id, null)?.value || ""}
                        onBlur={(e) => setVal(a.id, null, e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    {comps.map((c) => (
                      <TableCell key={c.id}>
                        <Input
                          defaultValue={findVal(a.id, c.id)?.value || ""}
                          onBlur={(e) => setVal(a.id, c.id, e.target.value)}
                          className="h-8"
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* -------- Launch Plans + Milestones -------- */
function LaunchTab({ product }: { product: Product }) {
  const [plans, setPlans] = useState<LaunchPlan[]>([]);
  const [miles, setMiles] = useState<Record<string, Milestone[]>>({});
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [planDlg, setPlanDlg] = useState(false);
  const [planEdit, setPlanEdit] = useState<Partial<LaunchPlan> | null>(null);
  const [mDlg, setMDlg] = useState(false);
  const [mEdit, setMEdit] = useState<Partial<Milestone> | null>(null);

  const load = async () => {
    const { data } = await supabase.from("crm_launch_plans").select("*").eq("product_id", product.id).order("created_at", { ascending: false });
    const list = (data || []) as LaunchPlan[];
    setPlans(list);
    if (list.length) {
      const { data: ms } = await supabase.from("crm_launch_milestones")
        .select("*").in("plan_id", list.map((p) => p.id)).order("sort_order");
      const grouped: Record<string, Milestone[]> = {};
      (ms || []).forEach((m: any) => {
        grouped[m.plan_id] = grouped[m.plan_id] || [];
        grouped[m.plan_id].push(m as Milestone);
      });
      setMiles(grouped);
    }
  };
  useEffect(() => { load(); }, [product.id]);

  const savePlan = async () => {
    if (!planEdit?.name) return toast.error("Name required");
    const payload = {
      product_id: product.id,
      name: planEdit.name,
      launch_date: planEdit.launch_date || null,
      status: planEdit.status || "Planned",
      owner: planEdit.owner || null,
      channels: typeof planEdit.channels === "string"
        ? (planEdit.channels as unknown as string).split(",").map((s) => s.trim()).filter(Boolean)
        : planEdit.channels || [],
      budget: planEdit.budget ?? null,
      notes: planEdit.notes || null,
    };
    const q = planEdit.id
      ? supabase.from("crm_launch_plans").update(payload).eq("id", planEdit.id)
      : supabase.from("crm_launch_plans").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setPlanDlg(false); setPlanEdit(null); load();
  };
  const delPlan = async (id: string) => {
    if (!confirm("Delete plan and its milestones?")) return;
    await supabase.from("crm_launch_plans").delete().eq("id", id);
    load();
  };

  const [mUploading, setMUploading] = useState(false);

  const uploadMilestoneFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMUploading(true);
    try {
      const folder = mEdit?.id || `new-${Date.now()}`;
      const uploaded: MilestoneAttachment[] = [];
      for (const file of Array.from(files)) {
        const path = `milestones/${folder}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("crm-content").upload(path, file, { upsert: false });
        if (upErr) { toast.error(`${file.name}: ${upErr.message}`); continue; }
        const { data: pub } = supabase.storage.from("crm-content").getPublicUrl(path);
        uploaded.push({
          url: pub.publicUrl,
          name: file.name,
          type: file.type,
          size: file.size,
          path,
          uploaded_at: new Date().toISOString(),
        });
      }
      if (uploaded.length) {
        setMEdit({ ...mEdit, attachments: [...(mEdit?.attachments || []), ...uploaded] });
        toast.success(`${uploaded.length} file(s) uploaded`);
      }
    } finally {
      setMUploading(false);
    }
  };

  const removeMilestoneAttachment = async (att: MilestoneAttachment) => {
    await supabase.storage.from("crm-content").remove([att.path]).catch(() => {});
    setMEdit({ ...mEdit, attachments: (mEdit?.attachments || []).filter((a) => a.path !== att.path) });
  };

  const saveM = async () => {
    if (!mEdit?.title || !mEdit.plan_id) return toast.error("Title required");
    const payload = {
      plan_id: mEdit.plan_id,
      title: mEdit.title,
      due_date: mEdit.due_date || null,
      owner: mEdit.owner || null,
      status: mEdit.status || "Pending",
      sort_order: mEdit.sort_order ?? 0,
      notes: mEdit.notes || null,
      attachments: (mEdit.attachments || []) as any,
    };
    const q = mEdit.id
      ? supabase.from("crm_launch_milestones").update(payload).eq("id", mEdit.id)
      : supabase.from("crm_launch_milestones").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setMDlg(false); setMEdit(null); load();
  };
  const delM = async (id: string) => {
    if (!confirm("Delete milestone?")) return;
    await supabase.from("crm_launch_milestones").delete().eq("id", id);
    load();
  };

  const planProgress = (planId: string) => {
    const list = miles[planId] || [];
    if (!list.length) return 0;
    const done = list.filter((m) => m.status === "Done").length;
    return Math.round((done / list.length) * 100);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setPlanEdit({ status: "Planned" }); setPlanDlg(true); }}><Plus className="h-4 w-4 mr-1" />New Launch Plan</Button>
      </div>
      {plans.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No launch plans yet.</CardContent></Card>
      ) : plans.map((p) => (
        <Card key={p.id}>
          <CardHeader className="p-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base">{p.name}</CardTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge className={STATUS_COLOR[p.status] || ""}>{p.status}</Badge>
                  {p.launch_date && <span className="text-xs text-muted-foreground">Launch: {format(new Date(p.launch_date), "dd MMM yyyy")}</span>}
                  {p.owner && <span className="text-xs text-muted-foreground">Owner: {p.owner}</span>}
                  {p.budget != null && <span className="text-xs text-muted-foreground">Budget: Rs. {Number(p.budget).toLocaleString()}</span>}
                  <span className="text-xs font-medium">{planProgress(p.id)}% complete</span>
                </div>
                {p.channels && p.channels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {p.channels.map((c) => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setOpenPlan(openPlan === p.id ? null : p.id)}>
                  {openPlan === p.id ? "Hide" : "Milestones"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setPlanEdit({ ...p, channels: p.channels as any }); setPlanDlg(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => delPlan(p.id)}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
              </div>
            </div>
            {p.notes && <p className="text-sm text-muted-foreground mt-2">{p.notes}</p>}
          </CardHeader>
          {openPlan === p.id && (
            <CardContent className="p-4 pt-0 border-t">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-medium">Milestones</h4>
                <Button size="sm" variant="outline" onClick={() => { setMEdit({ plan_id: p.id, status: "Pending", sort_order: (miles[p.id] || []).length }); setMDlg(true); }}>
                  <Plus className="h-4 w-4 mr-1" />Add
                </Button>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Title</TableHead><TableHead>Due</TableHead><TableHead>Owner</TableHead><TableHead>Status</TableHead><TableHead className="w-20"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(miles[p.id] || []).length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No milestones</TableCell></TableRow>
                  ) : (miles[p.id] || []).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{m.title}</span>
                          {m.attachments && m.attachments.length > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" title={`${m.attachments.length} attachment(s)`}>
                              <Paperclip className="h-3 w-3" />{m.attachments.length}
                            </span>
                          )}
                          {m.notes && <span className="text-xs text-muted-foreground" title={m.notes}>📝</span>}
                        </div>
                      </TableCell>
                      <TableCell>{m.due_date ? format(new Date(m.due_date), "dd MMM yyyy") : "-"}</TableCell>
                      <TableCell>{m.owner || "-"}</TableCell>
                      <TableCell><Badge className={STATUS_COLOR[m.status]}>{m.status}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => { setMEdit(m); setMDlg(true); }}><Pencil className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => delM(m.id)}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      ))}

      {/* Plan dialog */}
      <Dialog open={planDlg} onOpenChange={setPlanDlg}>
        <DialogContent className="max-w-xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{planEdit?.id ? "Edit" : "New"} Launch Plan</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *" className="col-span-2"><Input value={planEdit?.name || ""} onChange={(e) => setPlanEdit({ ...planEdit, name: e.target.value })} /></Field>
            <Field label="Launch Date"><Input type="date" value={planEdit?.launch_date || ""} onChange={(e) => setPlanEdit({ ...planEdit, launch_date: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={planEdit?.status || "Planned"} onValueChange={(v) => setPlanEdit({ ...planEdit, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PLAN_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Owner"><Input value={planEdit?.owner || ""} onChange={(e) => setPlanEdit({ ...planEdit, owner: e.target.value })} /></Field>
            <Field label="Budget (Rs.)"><Input type="number" value={planEdit?.budget ?? ""} onChange={(e) => setPlanEdit({ ...planEdit, budget: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Channels (comma separated)" className="col-span-2">
              <Input
                value={Array.isArray(planEdit?.channels) ? (planEdit?.channels as string[]).join(", ") : (planEdit?.channels as unknown as string) || ""}
                onChange={(e) => setPlanEdit({ ...planEdit, channels: e.target.value as unknown as string[] })}
              />
            </Field>
            <Field label="Notes" className="col-span-2"><Textarea rows={3} value={planEdit?.notes || ""} onChange={(e) => setPlanEdit({ ...planEdit, notes: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDlg(false)}>Cancel</Button>
            <Button onClick={savePlan}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Milestone dialog */}
      <Dialog open={mDlg} onOpenChange={setMDlg}>
        <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{mEdit?.id ? "Edit" : "New"} Milestone</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title *" className="col-span-2"><Input value={mEdit?.title || ""} onChange={(e) => setMEdit({ ...mEdit, title: e.target.value })} /></Field>
            <Field label="Due Date"><Input type="date" value={mEdit?.due_date || ""} onChange={(e) => setMEdit({ ...mEdit, due_date: e.target.value })} /></Field>
            <Field label="Owner"><Input value={mEdit?.owner || ""} onChange={(e) => setMEdit({ ...mEdit, owner: e.target.value })} /></Field>
            <Field label="Status" className="col-span-2">
              <Select value={mEdit?.status || "Pending"} onValueChange={(v) => setMEdit({ ...mEdit, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MILESTONE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Notes" className="col-span-2">
              <Textarea rows={4} value={mEdit?.notes || ""} onChange={(e) => setMEdit({ ...mEdit, notes: e.target.value })} placeholder="Add notes, observations, decisions..." />
            </Field>
            <Field label="Attachments (images, PDFs, files)" className="col-span-2">
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer border-2 border-dashed rounded-md p-3 hover:bg-muted/50 transition-colors">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {mUploading ? "Uploading..." : "Click to upload (multiple allowed)"}
                  </span>
                  <input
                    type="file"
                    multiple
                    accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                    className="hidden"
                    disabled={mUploading}
                    onChange={(e) => { uploadMilestoneFiles(e.target.files); e.target.value = ""; }}
                  />
                </label>
                {(mEdit?.attachments || []).length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {(mEdit?.attachments || []).map((att) => {
                      const isImage = att.type.startsWith("image/");
                      return (
                        <div key={att.path} className="relative group border rounded-md overflow-hidden bg-muted">
                          {isImage ? (
                            <a href={att.url} target="_blank" rel="noreferrer">
                              <img src={att.url} alt={att.name} className="w-full h-20 object-cover" />
                            </a>
                          ) : (
                            <a href={att.url} target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center h-20 p-2 text-center">
                              <FileText className="h-6 w-6 text-muted-foreground" />
                              <span className="text-[10px] truncate w-full mt-1">{att.name}</span>
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => removeMilestoneAttachment(att)}
                            className="absolute top-1 right-1 bg-rose-500 text-white rounded-full p-0.5 opacity-80 hover:opacity-100"
                            aria-label="Remove"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMDlg(false)}>Cancel</Button>
            <Button onClick={saveM}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================ Roadmap Tab ============================

type RoadmapItem = {
  id: string;
  product_id: string;
  launch_plan_id: string | null;
  title: string;
  description: string | null;
  owner_name: string | null;
  priority: string;
  status: string;
  start_date: string;
  end_date: string;
  progress_pct: number;
};

const ROADMAP_PRIORITIES = ["High", "Medium", "Low"];
const ROADMAP_STATUSES = ["Planned", "In Progress", "On Hold", "Completed", "Cancelled"];

const PRIORITY_COLOR: Record<string, string> = {
  High: "bg-rose-500",
  Medium: "bg-amber-500",
  Low: "bg-sky-500",
};
const PRIORITY_BADGE: Record<string, string> = {
  High: "bg-rose-100 text-rose-700",
  Medium: "bg-amber-100 text-amber-700",
  Low: "bg-sky-100 text-sky-700",
};
const ROADMAP_STATUS_COLOR: Record<string, string> = {
  Planned: "bg-blue-100 text-blue-700",
  "In Progress": "bg-amber-100 text-amber-700",
  "On Hold": "bg-slate-200 text-slate-700",
  Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-rose-100 text-rose-700",
};

function RoadmapTab({ products, selectedProductId }: { products: Product[]; selectedProductId: string | null }) {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [plans, setPlans] = useState<{ id: string; name: string; product_id: string }[]>([]);
  const [productFilter, setProductFilter] = useState<string>(selectedProductId || "all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [monthOffset, setMonthOffset] = useState(0);
  const VISIBLE_MONTHS = 6;

  const [dlg, setDlg] = useState(false);
  const [edit, setEdit] = useState<Partial<RoadmapItem> | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("crm_product_roadmap_items")
      .select("*")
      .order("start_date", { ascending: true });
    if (error) return toast.error(error.message);
    setItems((data || []) as RoadmapItem[]);
    const { data: pl } = await supabase.from("crm_launch_plans").select("id,name,product_id");
    setPlans((pl || []) as { id: string; name: string; product_id: string }[]);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (selectedProductId) setProductFilter(selectedProductId); }, [selectedProductId]);

  const productMap = useMemo(() => {
    const m: Record<string, Product> = {};
    products.forEach((p) => { m[p.id] = p; });
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (productFilter !== "all" && it.product_id !== productFilter) return false;
      if (priorityFilter !== "all" && it.priority !== priorityFilter) return false;
      if (statusFilter !== "all" && it.status !== statusFilter) return false;
      return true;
    });
  }, [items, productFilter, priorityFilter, statusFilter]);

  // Gantt window
  const windowStart = startOfMonth(addMonths(new Date(), monthOffset));
  const months = Array.from({ length: VISIBLE_MONTHS }, (_, i) => addMonths(windowStart, i));
  const windowEnd = endOfMonth(months[months.length - 1]);
  const totalDays = differenceInDays(windowEnd, windowStart) + 1;

  const save = async () => {
    if (!edit?.title) return toast.error("Title required");
    if (!edit?.product_id) return toast.error("Product required");
    if (!edit?.start_date || !edit?.end_date) return toast.error("Dates required");
    if (edit.end_date < edit.start_date) return toast.error("End date must be after start");
    const payload = {
      product_id: edit.product_id,
      launch_plan_id: edit.launch_plan_id === "none" ? null : edit.launch_plan_id || null,
      title: edit.title,
      description: edit.description || null,
      owner_name: edit.owner_name || null,
      priority: edit.priority || "Medium",
      status: edit.status || "Planned",
      start_date: edit.start_date,
      end_date: edit.end_date,
      progress_pct: edit.progress_pct ?? 0,
    };
    const q = edit.id
      ? supabase.from("crm_product_roadmap_items").update(payload).eq("id", edit.id)
      : supabase.from("crm_product_roadmap_items").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setDlg(false); setEdit(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this roadmap item?")) return;
    const { error } = await supabase.from("crm_product_roadmap_items").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  const planOptions = useMemo(() => {
    if (!edit?.product_id) return [];
    return plans.filter((pl) => pl.product_id === edit.product_id);
  }, [plans, edit?.product_id]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <Select value={productFilter} onValueChange={setProductFilter}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Products</SelectItem>
              {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              {ROADMAP_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {ROADMAP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(monthOffset - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-xs text-muted-foreground min-w-[140px] text-center">
            {format(windowStart, "MMM yyyy")} – {format(windowEnd, "MMM yyyy")}
          </div>
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(monthOffset + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(0)}>Today</Button>
          <Button
            size="sm"
            onClick={() => {
              const initialProduct = productFilter !== "all" ? productFilter : products[0]?.id;
              if (!initialProduct) { toast.error("Create a product first"); return; }
              const today = format(new Date(), "yyyy-MM-dd");
              const inAMonth = format(addMonths(new Date(), 1), "yyyy-MM-dd");
              setEdit({
                product_id: initialProduct,
                title: "",
                priority: "Medium",
                status: "Planned",
                start_date: today,
                end_date: inAMonth,
                progress_pct: 0,
              });
              setDlg(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Item
          </Button>
        </CardContent>
      </Card>

      {/* Gantt */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <GanttChart className="h-4 w-4" /> Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">No roadmap items in this view.</div>
          ) : (
            <div className="min-w-[800px]">
              {/* Month headers */}
              <div className="grid border-b bg-muted/30" style={{ gridTemplateColumns: `260px repeat(${VISIBLE_MONTHS}, 1fr)` }}>
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-r">
                  Item
                </div>
                {months.map((m) => (
                  <div key={m.toISOString()} className="px-2 py-2 text-xs font-semibold text-center text-muted-foreground border-r last:border-r-0">
                    {format(m, "MMM yyyy")}
                  </div>
                ))}
              </div>
              {/* Rows */}
              {filtered.map((it) => {
                const s = parseISO(it.start_date);
                const e = parseISO(it.end_date);
                const visibleStart = dateMax([s, windowStart]);
                const visibleEnd = dateMin([e, windowEnd]);
                const visible = visibleEnd >= visibleStart;
                const leftPct = visible ? (differenceInDays(visibleStart, windowStart) / totalDays) * 100 : 0;
                const widthPct = visible ? ((differenceInDays(visibleEnd, visibleStart) + 1) / totalDays) * 100 : 0;
                const product = productMap[it.product_id];
                const isDimmed = it.status === "On Hold" || it.status === "Cancelled";
                return (
                  <div
                    key={it.id}
                    className="grid border-b hover:bg-muted/30 group"
                    style={{ gridTemplateColumns: `260px repeat(${VISIBLE_MONTHS}, 1fr)` }}
                  >
                    <div className="px-3 py-2 border-r flex items-start gap-2 min-h-[52px]">
                      <span className={`mt-1.5 w-2 h-2 rounded-full ${PRIORITY_COLOR[it.priority] || "bg-slate-400"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground truncate">{product?.name || "—"}</div>
                        <div className="text-sm font-medium truncate">{it.title}</div>
                      </div>
                      <div className="flex opacity-0 group-hover:opacity-100 transition">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEdit(it); setDlg(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" onClick={() => remove(it.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {/* Timeline area spanning all months */}
                    <div className="relative col-span-full" style={{ gridColumn: `2 / span ${VISIBLE_MONTHS}` }}>
                      <div className="absolute inset-0 grid pointer-events-none" style={{ gridTemplateColumns: `repeat(${VISIBLE_MONTHS}, 1fr)` }}>
                        {months.map((m) => <div key={m.toISOString()} className="border-r last:border-r-0" />)}
                      </div>
                      {visible && (
                        <button
                          type="button"
                          onClick={() => { setEdit(it); setDlg(true); }}
                          title={`${it.title}\n${format(s, "dd MMM yyyy")} – ${format(e, "dd MMM yyyy")}\nOwner: ${it.owner_name || "—"}\nProgress: ${it.progress_pct}%`}
                          className={`absolute top-2 h-8 rounded-md shadow-sm ${PRIORITY_COLOR[it.priority] || "bg-slate-400"} ${isDimmed ? "opacity-40" : ""} hover:ring-2 hover:ring-offset-1 hover:ring-primary transition`}
                          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 1.5)}%` }}
                        >
                          <div
                            className="absolute inset-y-0 left-0 bg-black/25 rounded-l-md"
                            style={{ width: `${it.progress_pct}%` }}
                          />
                          <div className="relative px-2 text-[10px] text-white font-medium leading-8 truncate text-left">
                            {it.progress_pct}%
                          </div>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">All Items</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No items</TableCell></TableRow>
              ) : filtered.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="text-sm">{productMap[it.product_id]?.name || "—"}</TableCell>
                  <TableCell className="text-sm font-medium">{it.title}</TableCell>
                  <TableCell className="text-sm">{it.owner_name || "—"}</TableCell>
                  <TableCell><Badge className={PRIORITY_BADGE[it.priority]}>{it.priority}</Badge></TableCell>
                  <TableCell><Badge className={ROADMAP_STATUS_COLOR[it.status]}>{it.status}</Badge></TableCell>
                  <TableCell className="text-xs">{format(parseISO(it.start_date), "dd MMM yy")} → {format(parseISO(it.end_date), "dd MMM yy")}</TableCell>
                  <TableCell className="text-sm">{it.progress_pct}%</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEdit(it); setDlg(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" onClick={() => remove(it.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit/Create Dialog */}
      <Dialog open={dlg} onOpenChange={(o) => { setDlg(o); if (!o) setEdit(null); }}>
        <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit?.id ? "Edit Roadmap Item" : "New Roadmap Item"}</DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Product *">
                <Select value={edit.product_id || ""} onValueChange={(v) => setEdit({ ...edit, product_id: v, launch_plan_id: null })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Launch Plan (optional)">
                <Select
                  value={edit.launch_plan_id || "none"}
                  onValueChange={(v) => setEdit({ ...edit, launch_plan_id: v === "none" ? null : v })}
                >
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {planOptions.map((pl) => <SelectItem key={pl.id} value={pl.id}>{pl.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Title *" className="md:col-span-2">
                <Input value={edit.title || ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              </Field>
              <Field label="Description" className="md:col-span-2">
                <Textarea rows={3} value={edit.description || ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
              </Field>
              <Field label="Owner">
                <Input value={edit.owner_name || ""} onChange={(e) => setEdit({ ...edit, owner_name: e.target.value })} />
              </Field>
              <Field label="Priority">
                <Select value={edit.priority || "Medium"} onValueChange={(v) => setEdit({ ...edit, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROADMAP_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={edit.status || "Planned"} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROADMAP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Progress %">
                <div className="flex items-center gap-3">
                  <Slider
                    value={[edit.progress_pct ?? 0]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={(v) => setEdit({ ...edit, progress_pct: v[0] })}
                    className="flex-1"
                  />
                  <span className="text-sm w-10 text-right">{edit.progress_pct ?? 0}%</span>
                </div>
              </Field>
              <Field label="Start Date *">
                <Input type="date" value={edit.start_date || ""} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} />
              </Field>
              <Field label="End Date *">
                <Input type="date" value={edit.end_date || ""} onChange={(e) => setEdit({ ...edit, end_date: e.target.value })} />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
