import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STOCK_CATEGORIES, type StockCategory, type StockCategoryFilterValue } from "@/lib/stockCategories";

interface StockCategoryFilterProps {
  value: StockCategoryFilterValue;
  onChange: (value: StockCategoryFilterValue) => void;
  /** Limit the options, e.g. to held categories only. Defaults to every category. */
  categories?: StockCategory[];
  className?: string;
}

/** "All stock categories" + one option per planning_items.stock_category. */
export function StockCategoryFilter({ value, onChange, categories, className = "w-48" }: StockCategoryFilterProps) {
  const options = categories ? STOCK_CATEGORIES.filter((c) => categories.includes(c.value)) : STOCK_CATEGORIES;
  return (
    <Select value={value} onValueChange={(v) => onChange(v as StockCategoryFilterValue)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Stock category" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Stock Categories</SelectItem>
        {options.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
