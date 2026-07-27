import { useState, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, EyeOff } from "lucide-react";

/**
 * Privacy wrapper for financial reports: the wrapped content (key figures,
 * statement tables) stays hidden when the page opens and is only revealed
 * after an explicit click, so opening the report in front of someone doesn't
 * expose the numbers. Visibility resets on every page visit by design.
 */
export function HiddenFigures({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  if (!visible) {
    return (
      <Card
        role="button"
        className="cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => setVisible(true)}
      >
        <CardContent className="py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <EyeOff className="h-10 w-10" />
          <div className="text-sm font-medium">Figures are hidden for privacy</div>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setVisible(true);
            }}
          >
            <Eye className="h-4 w-4 mr-1" />Show figures
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setVisible(false)}>
          <EyeOff className="h-4 w-4 mr-1" />Hide figures
        </Button>
      </div>
      {children}
    </div>
  );
}
