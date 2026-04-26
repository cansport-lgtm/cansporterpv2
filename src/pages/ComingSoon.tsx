import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

interface ComingSoonProps {
  title: string;
  description?: string;
}

export default function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <ERPLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-10 pb-10">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-6">
              <Construction className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold mb-2">{title}</h1>
            <p className="text-muted-foreground">
              {description || "This module is under development and will be available soon."}
            </p>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}