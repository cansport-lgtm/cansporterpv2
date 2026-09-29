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
import { useIsMobile } from "@/hooks/use-mobile";
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
   * How rows are presented below the `md` breakpoint.
   * - `cards` (default): each row becomes a stacked label/value card, which is
   *   far easier to read and tap on a phone than a squeezed table.
   * - `table`: keep the horizontally scrollable table on every screen size.
   * Desktop always renders the table.
   */
  mobileLayout?: "cards" | "table";
}

export function DataTable<T extends { id: string | number }>({
  columns,
  data,
  onRowClick,
  emptyMessage = "No data available",
  className,
  expandedRowRender,
  mobileLayout = "cards",
}: DataTableProps<T>) {
  const [expandedRows, setExpandedRows] = useState<Set<string | number>>(new Set());
  const isMobile = useIsMobile();

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

  const renderCell = (column: Column<T>, item: T): React.ReactNode =>
    column.render
      ? column.render(item)
      : String(getNestedValue(item, String(column.key)) ?? "-");

  // ── Phone layout: one card per row ──────────────────────────────────────
  if (isMobile && mobileLayout === "cards") {
    return (
      <div className={cn("space-y-3", className)}>
        {data.length === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          data.map((item) => {
            const isExpanded = expandedRows.has(item.id);
            return (
              <div
                key={item.id}
                onClick={() => onRowClick?.(item)}
                className={cn(
                  "rounded-xl border bg-card p-3 shadow-xs",
                  onRowClick && "cursor-pointer active:bg-muted/40"
                )}
              >
                <dl className="grid grid-cols-[minmax(0,38%)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                  {columns.map((column) => {
                    const label = column.header?.trim();
                    const value = renderCell(column, item);
                    return (
                      <React.Fragment key={String(column.key)}>
                        {label ? (
                          <dt className="self-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {label}
                          </dt>
                        ) : null}
                        <dd
                          className={cn(
                            "min-w-0 break-words [&_button]:min-h-9",
                            label ? "text-right" : "col-span-2 flex flex-wrap justify-end gap-2"
                          )}
                        >
                          {value}
                        </dd>
                      </React.Fragment>
                    );
                  })}
                </dl>
                {hasExpandable && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRowExpansion(item.id);
                      }}
                      className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      {isExpanded ? "Hide details" : "Show details"}
                    </button>
                    {isExpanded && (
                      <div className="mt-3 -mx-3 -mb-3 rounded-b-xl border-t bg-muted/30 overflow-x-auto">
                        {expandedRowRender(item)}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  }

  // ── Table layout (desktop, or mobileLayout="table") ─────────────────────
  return (
    <div className={cn("rounded-lg border bg-card overflow-x-auto", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            {hasExpandable && <TableHead className="w-10" />}
            {columns.map((column) => (
              <TableHead
                key={String(column.key)}
                className={cn(
                  "text-xs font-semibold uppercase tracking-wider text-muted-foreground",
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
                      {renderCell(column, item)}
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
      </Table>
    </div>
  );
}
