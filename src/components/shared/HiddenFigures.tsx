import { useState, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, EyeOff } from "lucide-react";

/**
 * Privacy wrapper for the key-figure totals on financial reports: the wrapped
 * summary cards stay hidden when the page opens and are only revealed after an
 * explicit click, so opening the report in front of someone doesn't expose the
 * headline numbers. Visibility resets on every page visit by design.
 */
export function HiddenFigures({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  if (!visible) {
    return (
      <Card
        role="button"
        className="mb-4 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => setVisible(true)}
      >
        <CardContent className="p-4 flex items-center justify-center gap-2 text-muted-foreground">
          <EyeOff className="h-4 w-4" />
          <span className="text-sm font-medium">Key figures are hidden — click to show</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-muted-foreground"
          onClick={() => setVisible(false)}
        >
          <EyeOff className="h-4 w-4 mr-1" />Hide figures
        </Button>
      </div>
      {children}
    </div>
  );
}
