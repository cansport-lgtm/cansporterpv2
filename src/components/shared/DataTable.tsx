import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
  className?: string;
  expandedRowRender?: (item: T) => React.ReactNode;
  /**
   * Wide tables: the table scrolls inside a box that fits the screen, so the
   * sideways scrollbar is always visible and the header row stays on top.
   * Columns can pin themselves with sticky left/right classes.
   */
  fitScreen?: boolean;
}

export function DataTable<T extends { id: string | number }>({
  columns,
  data,
  onRowClick,
  emptyMessage = "No data available",
  className,
  expandedRowRender,
  fitScreen = false,
}: DataTableProps<T>) {
  const [expandedRows, setExpandedRows] = useState<Set<string | number>>(new Set());

  const getNestedValue = (obj: T, path: string): unknown => {
    return path.split(".").reduce((acc: unknown, part) => {
      if (acc && typeof acc === "object" && part in acc) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, obj);
  };

  const toggleRowExpansion = (id: string | number) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const hasExpandable = !!expandedRowRender;

  // fitScreen renders a bare <table> so this box (not Table's own wrapper)
  // is the scroll container that sticky header / columns stick to.
  const TableEl = fitScreen ? BareTable : Table;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card overflow-x-auto",
        fitScreen && "max-h-[calc(100vh-15rem)] min-h-[16rem] overflow-auto",
        className
      )}
    >
      <TableEl>
        <TableHeader className={cn(fitScreen && "sticky top-0 z-20 bg-muted shadow-[0_1px_0_hsl(var(--border))]")}>
          <TableRow className={cn("bg-muted/50 hover:bg-muted/50", fitScreen && "bg-muted hover:bg-muted")}>
            {hasExpandable && <TableHead className="w-10" />}
            {columns.map((column) => (
              <TableHead
                key={String(column.key)}
                className={cn(
                  "text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                  fitScreen && "whitespace-nowrap bg-muted",
                  column.className
                )}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (hasExpandable ? 1 : 0)}
                className="text-center py-8 text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((item) => (
              <React.Fragment key={item.id}>
                <TableRow
                  onClick={() => onRowClick?.(item)}
                  className={cn(onRowClick && "cursor-pointer")}
                >
                  {hasExpandable && (
                    <TableCell className="w-10 p-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRowExpansion(item.id);
                        }}
                        className="p-1 hover:bg-muted rounded"
                      >
                        {expandedRows.has(item.id) ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </TableCell>
                  )}
                  {columns.map((column) => (
                    <TableCell key={String(column.key)} className={column.className}>
                      {column.render
                        ? column.render(item)
                        : String(getNestedValue(item, String(column.key)) ?? "-")}
                    </TableCell>
                  ))}
                </TableRow>
                {hasExpandable && expandedRows.has(item.id) && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={columns.length + 1} className="p-0">
                      {expandedRowRender(item)}
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))
          )}
        </TableBody>
      </TableEl>
    </div>
  );
}

function BareTable({ children }: { children: React.ReactNode }) {
  return <table className="w-full caption-bottom text-sm">{children}</table>;
}
