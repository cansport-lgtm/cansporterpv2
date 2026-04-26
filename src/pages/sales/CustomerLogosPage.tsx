import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Search, Image, X, Building2, Plus, Star, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";

interface Customer {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

interface CustomerLogo {
  id: string;
  customer_id: string;
  logo_url: string;
  label: string | null;
  is_primary: boolean;
  created_at: string;
}

export default function CustomerLogosPage() {
  const queryClient = useQueryClient();
  const { hasModulePermission, user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [logoLabel, setLogoLabel] = useState('');
  const [uploading, setUploading] = useState(false);

  const canEdit = hasModulePermission('sales', 'edit');

  // Fetch customers
  const { data: customers, isLoading: customersLoading } = useQuery({
    queryKey: ['customers-logos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, code, name, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      return data as Customer[];
    },
  });

  // Fetch all customer logos
  const { data: customerLogos, isLoading: logosLoading } = useQuery({
    queryKey: ['customer-logos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_logos')
        .select('*')
        .order('is_primary', { ascending: false });

      if (error) throw error;
      return data as CustomerLogo[];
    },
  });

  // Logo upload mutation
  const uploadLogoMutation = useMutation({
    mutationFn: async ({ customerId, file, label }: { customerId: string; file: File; label: string }) => {
      setUploading(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `${customerId}-${Date.now()}.${fileExt}`;
      const filePath = `logos/${fileName}`;

      // Upload file
      const { error: uploadError } = await supabase.storage
        .from('customer-logos')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('customer-logos')
        .getPublicUrl(filePath);

      // Check if this is the first logo for the customer
      const existingLogos = customerLogos?.filter(l => l.customer_id === customerId) || [];
      const isPrimary = existingLogos.length === 0;

      // Insert into customer_logos table
      const { error: insertError } = await supabase
        .from('customer_logos')
        .insert({
          customer_id: customerId,
          logo_url: publicUrl,
          label: label || null,
          is_primary: isPrimary,
          created_by: user?.id || null
        });

      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-logos'] });
      toast.success('Logo uploaded successfully');
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
    onSettled: () => {
      setUploading(false);
    },
  });

  // Delete logo mutation
  const deleteLogoMutation = useMutation({
    mutationFn: async (logo: CustomerLogo) => {
      // Extract file path from URL
      const urlParts = logo.logo_url.split('/customer-logos/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1];
        await supabase.storage.from('customer-logos').remove([filePath]);
      }

      // Delete from database
      const { error } = await supabase
        .from('customer_logos')
        .delete()
        .eq('id', logo.id);

      if (error) throw error;

      // If this was primary, make another logo primary
      if (logo.is_primary) {
        const remainingLogos = customerLogos?.filter(l => 
          l.customer_id === logo.customer_id && l.id !== logo.id
        );
        if (remainingLogos && remainingLogos.length > 0) {
          await supabase
            .from('customer_logos')
            .update({ is_primary: true })
            .eq('id', remainingLogos[0].id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-logos'] });
      toast.success('Logo deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Set primary logo mutation
  const setPrimaryMutation = useMutation({
    mutationFn: async (logo: CustomerLogo) => {
      // Remove primary from other logos of this customer
      await supabase
        .from('customer_logos')
        .update({ is_primary: false })
        .eq('customer_id', logo.customer_id);

      // Set this one as primary
      const { error } = await supabase
        .from('customer_logos')
        .update({ is_primary: true })
        .eq('id', logo.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-logos'] });
      toast.success('Primary logo updated');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleOpenDialog = (customer: Customer) => {
    setSelectedCustomer(customer);
    setLogoFile(null);
    setPreviewUrl(null);
    setLogoLabel('');
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedCustomer(null);
    setLogoFile(null);
    setPreviewUrl(null);
    setLogoLabel('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast.error('File size must be less than 2MB');
        return;
      }
      setLogoFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleUpload = () => {
    if (!selectedCustomer || !logoFile) return;
    uploadLogoMutation.mutate({ 
      customerId: selectedCustomer.id, 
      file: logoFile,
      label: logoLabel
    });
  };

  const handleDeleteLogo = (logo: CustomerLogo) => {
    if (confirm('Delete this logo?')) {
      deleteLogoMutation.mutate(logo);
    }
  };

  const handleSetPrimary = (logo: CustomerLogo) => {
    if (!logo.is_primary) {
      setPrimaryMutation.mutate(logo);
    }
  };

  // Group logos by customer
  const getLogosForCustomer = (customerId: string) => {
    return customerLogos?.filter(l => l.customer_id === customerId) || [];
  };

  const filteredCustomers = customers?.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const customersWithLogos = filteredCustomers?.filter(c => getLogosForCustomer(c.id).length > 0) || [];
  const customersWithoutLogos = filteredCustomers?.filter(c => getLogosForCustomer(c.id).length === 0) || [];

  const isLoading = customersLoading || logosLoading;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader 
          title="Customer Logo Portal" 
          description="Manage private label customer logos for branding"
        />

        {/* Search */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {customersWithLogos.length} with logos • {customersWithoutLogos.length} pending
          </div>
        </div>

        {/* Customers with Logos */}
        {customersWithLogos.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Image className="h-5 w-5 text-primary" />
              Customers with Logos
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {customersWithLogos.map((customer) => {
                const logos = getLogosForCustomer(customer.id);
                return (
                  <Card key={customer.id} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-medium">{customer.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{customer.code}</p>
                        </div>
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenDialog(customer)}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Add
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {logos.map((logo) => (
                          <div
                            key={logo.id}
                            className="relative group aspect-square bg-white rounded-lg border flex items-center justify-center overflow-hidden"
                          >
                            <img
                              src={logo.logo_url}
                              alt={logo.label || 'Logo'}
                              className="max-w-full max-h-full object-contain p-1"
                            />
                            {logo.is_primary && (
                              <Badge className="absolute top-1 left-1 h-5 px-1 text-xs bg-amber-500">
                                <Star className="h-3 w-3" />
                              </Badge>
                            )}
                            {canEdit && (
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                                {!logo.is_primary && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-white hover:bg-white/20"
                                    onClick={() => handleSetPrimary(logo)}
                                    title="Set as primary"
                                  >
                                    <Star className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-white hover:bg-red-500/80"
                                  onClick={() => handleDeleteLogo(logo)}
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                            {logo.label && (
                              <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 truncate px-1">
                                {logo.label}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Customers without Logos */}
        {customersWithoutLogos.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              Pending Logo Upload
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {customersWithoutLogos.map((customer) => (
                <Card 
                  key={customer.id} 
                  className={`overflow-hidden transition-shadow ${canEdit ? 'hover:shadow-lg cursor-pointer' : ''}`}
                  onClick={() => canEdit && handleOpenDialog(customer)}
                >
                  <CardContent className="p-4">
                    <div className="aspect-square mb-3 bg-muted rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center">
                      <Upload className="h-8 w-8 text-muted-foreground/50 mb-2" />
                      <span className="text-xs text-muted-foreground">Upload Logo</span>
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-sm truncate">{customer.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{customer.code}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading customers...
          </div>
        ) : filteredCustomers?.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No customers found
          </div>
        )}

        {/* Upload Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Logo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="text-center">
                <p className="font-medium">{selectedCustomer?.name}</p>
                <p className="text-sm text-muted-foreground font-mono">{selectedCustomer?.code}</p>
              </div>

              {/* Preview */}
              <div className="aspect-square max-w-48 mx-auto bg-white rounded-lg border-2 border-dashed flex items-center justify-center overflow-hidden">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Logo preview"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <div className="text-center p-4">
                    <Image className="h-12 w-12 mx-auto text-muted-foreground/30 mb-2" />
                    <span className="text-sm text-muted-foreground">Select image</span>
                  </div>
                )}
              </div>

              {/* Logo Label */}
              <div className="space-y-2">
                <Label htmlFor="logo-label">Label (Optional)</Label>
                <Input
                  id="logo-label"
                  placeholder="e.g., Main, Alternative, Holiday..."
                  value={logoLabel}
                  onChange={(e) => setLogoLabel(e.target.value)}
                />
              </div>

              {/* File Input */}
              <div className="space-y-2">
                <Label htmlFor="logo-file">Select Logo Image</Label>
                <Input
                  id="logo-file"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="cursor-pointer"
                />
                <p className="text-xs text-muted-foreground">
                  Supported: JPG, PNG, GIF, WEBP. Max 2MB. Square images work best.
                </p>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={handleCloseDialog}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleUpload} 
                  disabled={!logoFile || uploading}
                >
                  {uploading ? (
                    <>Uploading...</>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
