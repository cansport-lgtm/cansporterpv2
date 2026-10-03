import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface SalesOrdersListFooterProps {
  shown: number;
  total: number;
  hasMore: boolean;
  isFetching: boolean;
  isSearching: boolean;
  onLoadMore: () => void;
}

/** Row count and "Load more" control under a windowed sales order list. */
export function SalesOrdersListFooter({ shown, total, hasMore, isFetching, isSearching, onLoadMore }: SalesOrdersListFooterProps) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-2 pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        Showing {shown} of {total} order{total === 1 ? "" : "s"}
        {isSearching ? " matching your search" : ""}
      </span>
      {hasMore && (
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isFetching}>
          {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Load more
        </Button>
      )}
    </div>
  );
}
