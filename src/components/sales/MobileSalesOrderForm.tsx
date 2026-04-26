import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, ChevronLeft } from "lucide-react";
import { format } from "date-fns";

interface Customer {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  payment_terms?: number | null;
}

interface Product {
  id: string;
  code: string;
  name: string;
}

interface OrderItem {
  product_id: string;
  quantity_dozens: string;
  price_per_dozen: string;
  remarks: string;
}

interface FormData {
  customer_id: string;
  order_date: string;
  required_date: string;
  discount_percent: string;
  payment_terms: string;
  shipping_address: string;
  notes: string;
  items: OrderItem[];
}

interface MobileSalesOrderFormProps {
  formData: FormData;
  setFormData: (data: FormData) => void;
  customers?: Customer[];
  products?: Product[];
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isPending: boolean;
  onAddProduct: () => void;
}

export function MobileSalesOrderForm({
  formData,
  setFormData,
  customers,
  products,
  onSubmit,
  onCancel,
  isPending,
  onAddProduct,
}: MobileSalesOrderFormProps) {
  const [currentStep, setCurrentStep] = useState(1);

  const handleCustomerChange = (customerId: string) => {
    const customer = customers?.find(c => c.id === customerId);
    setFormData({
      ...formData,
      customer_id: customerId,
      payment_terms: customer?.payment_terms?.toString() || '',
      shipping_address: customer?.address || '',
    });
  };

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, {
        product_id: '',
        quantity_dozens: '',
        price_per_dozen: '',
        remarks: '',
      }],
    });
  };

  const updateItem = (index: number, field: keyof OrderItem, value: string) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };

  const removeItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const calculateTotal = () => {
    const subtotal = formData.items.reduce((sum, item) => {
      return sum + (parseFloat(item.quantity_dozens) || 0) * (parseFloat(item.price_per_dozen) || 0);
    }, 0);
    const discount = (subtotal * parseFloat(formData.discount_percent || '0')) / 100;
    return subtotal - discount;
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b bg-background sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={onCancel}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold flex-1">New Sales Order</h1>
        <div className="text-sm text-muted-foreground">
          Step {currentStep}/3
        </div>
      </div>

      {/* Step Indicators */}
      <div className="flex gap-1 px-4 py-2 bg-muted/50">
        {[1, 2, 3].map((step) => (
          <div
            key={step}
            className={`flex-1 h-1 rounded-full transition-colors ${
              step <= currentStep ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
          />
        ))}
      </div>

      {/* Content */}
      <form onSubmit={onSubmit} className="flex-1 overflow-y-auto">
        {/* Step 1: Customer & Order Details */}
        {currentStep === 1 && (
          <div className="p-4 space-y-4">
            <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">Order Details</h2>
            
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Customer *</Label>
                <Select value={formData.customer_id} onValueChange={handleCustomerChange}>
                  <SelectTrigger className="h-12">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} - {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Order Date</Label>
                  <Input
                    type="date"
                    value={formData.order_date}
                    onChange={(e) => setFormData({ ...formData, order_date: e.target.value })}
                    className="h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Required Date</Label>
                  <Input
                    type="date"
                    value={formData.required_date}
                    onChange={(e) => setFormData({ ...formData, required_date: e.target.value })}
                    className="h-12"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Payment Terms (Days)</Label>
                  <Input
                    value={formData.payment_terms}
                    onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })}
                    className="h-12"
                    placeholder="30"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Discount %</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={formData.discount_percent}
                    onChange={(e) => setFormData({ ...formData, discount_percent: e.target.value })}
                    className="h-12"
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Shipping Address</Label>
                <Textarea
                  value={formData.shipping_address}
                  onChange={(e) => setFormData({ ...formData, shipping_address: e.target.value })}
                  rows={3}
                  placeholder="Enter shipping address"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Order Items */}
        {currentStep === 2 && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">Order Items</h2>
              <Button type="button" size="sm" onClick={addItem}>
                <Plus className="h-4 w-4 mr-1" /> Add Item
              </Button>
            </div>

            {formData.items.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-3">No items added yet</p>
                <Button type="button" variant="outline" onClick={addItem}>
                  <Plus className="h-4 w-4 mr-1" /> Add First Item
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {formData.items.map((item, index) => (
                  <div key={index} className="border rounded-xl p-4 space-y-3 bg-card shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-primary">Item {index + 1}</span>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeItem(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Product</Label>
                      <div className="flex gap-2">
                        <Select value={item.product_id} onValueChange={(v) => updateItem(index, 'product_id', v)}>
                          <SelectTrigger className="h-11 flex-1">
                            <SelectValue placeholder="Select Product" />
                          </SelectTrigger>
                          <SelectContent>
                            {products?.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={onAddProduct}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label className="text-xs">Qty (Dozens)</Label>
                        <Input
                          type="number"
                          value={item.quantity_dozens}
                          onChange={(e) => updateItem(index, 'quantity_dozens', e.target.value)}
                          placeholder="0"
                          className="h-11"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Price/Dozen</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.price_per_dozen}
                          onChange={(e) => updateItem(index, 'price_per_dozen', e.target.value)}
                          className="h-11"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-2 border-t">
                      <span className="text-sm text-muted-foreground">Amount</span>
                      <span className="font-bold text-lg">
                        Rs. {((parseFloat(item.quantity_dozens) || 0) * (parseFloat(item.price_per_dozen) || 0)).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Review & Notes */}
        {currentStep === 3 && (
          <div className="p-4 space-y-4">
            <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">Review & Notes</h2>

            {/* Order Summary */}
            <div className="bg-muted/50 rounded-xl p-4 space-y-3">
              <h3 className="font-medium">Order Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-medium">
                    {customers?.find(c => c.id === formData.customer_id)?.name || '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Order Date</span>
                  <span>{formData.order_date || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Required Date</span>
                  <span>{formData.required_date || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items</span>
                  <span>{formData.items.length} item(s)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span>{formData.discount_percent || 0}%</span>
                </div>
              </div>
              <div className="pt-3 border-t flex justify-between items-center">
                <span className="font-medium">Net Amount</span>
                <span className="text-2xl font-bold text-primary">Rs. {calculateTotal().toLocaleString()}</span>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={4}
                placeholder="Add any notes or special instructions..."
              />
            </div>
          </div>
        )}
      </form>

      {/* Footer Navigation */}
      <div className="p-4 border-t bg-background sticky bottom-0 space-y-3">
        {currentStep === 3 && (
          <div className="flex justify-between items-center text-sm px-1">
            <span className="text-muted-foreground">Total</span>
            <span className="text-xl font-bold">Rs. {calculateTotal().toLocaleString()}</span>
          </div>
        )}
        <div className="flex gap-3">
          {currentStep > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentStep(currentStep - 1)}
              className="flex-1 h-12"
            >
              Back
            </Button>
          )}
          {currentStep < 3 ? (
            <Button
              type="button"
              onClick={() => setCurrentStep(currentStep + 1)}
              className="flex-1 h-12"
              disabled={currentStep === 1 && !formData.customer_id}
            >
              Continue
            </Button>
          ) : (
            <Button
              type="submit"
              onClick={onSubmit}
              disabled={isPending || formData.items.length === 0}
              className="flex-1 h-12"
            >
              {isPending ? 'Saving...' : 'Create Order'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
