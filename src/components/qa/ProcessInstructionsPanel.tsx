import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, AlertTriangle, Play, FileText, StickyNote } from "lucide-react";

interface ProcessInstructionsPanelProps {
  processId: string;
}

export function ProcessInstructionsPanel({ processId }: ProcessInstructionsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const { data: instructions = [] } = useQuery({
    queryKey: ["qa-process-instructions", processId],
    queryFn: async () => {
      if (!processId) return [];
      const { data, error } = await supabase
        .from("qa_process_instructions")
        .select("*")
        .eq("process_id", processId)
        .eq("is_active", true)
        .order("step_number");
      if (error) throw error;
      return data;
    },
    enabled: !!processId,
  });

  if (instructions.length === 0) return null;

  const getYouTubeEmbedUrl = (url: string) => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    return match ? `https://www.youtube.com/embed/${match[1]}` : null;
  };

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        className="w-full flex items-center justify-between px-4 py-3 h-auto"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4 text-primary" />
          Process Instructions ({instructions.length} steps)
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </Button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {instructions.map((inst: any) => (
            <div
              key={inst.id}
              className={`rounded-md p-3 text-sm space-y-1 ${
                inst.instruction_type === "safety"
                  ? "bg-orange-50 border border-orange-200 dark:bg-orange-950/30 dark:border-orange-800"
                  : inst.instruction_type === "note"
                  ? "bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-800"
                  : "bg-background border"
              }`}
            >
              <div className="flex items-center gap-2">
                {inst.instruction_type === "safety" ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                ) : inst.instruction_type === "note" ? (
                  <StickyNote className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                ) : (
                  <span className="text-xs font-bold text-muted-foreground w-5 flex-shrink-0">
                    {inst.step_number}.
                  </span>
                )}
                <span className="font-medium">{inst.title}</span>
              </div>
              {inst.description && (
                <p className="text-muted-foreground text-xs whitespace-pre-wrap ml-5">{inst.description}</p>
              )}
              {inst.image_url && (
                <img src={inst.image_url} alt={inst.title} className="max-h-40 rounded border object-contain ml-5 mt-1" />
              )}
              {inst.video_url && (
                <div className="ml-5 mt-1">
                  {getYouTubeEmbedUrl(inst.video_url) ? (
                    <iframe
                      src={getYouTubeEmbedUrl(inst.video_url)!}
                      className="w-full max-w-sm aspect-video rounded"
                      allowFullScreen
                    />
                  ) : (
                    <a href={inst.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <Play className="h-3 w-3" /> Watch Video
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
