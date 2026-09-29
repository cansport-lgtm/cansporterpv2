import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, photoUrl, uploadGatePassPhoto } from "@/lib/gatePass";

/** Take or pick a photo; it is uploaded straight away and its storage path handed back. */
export function PhotoInput({
  id, label, folder, value, onChange,
}: {
  id: string;
  label: string;
  folder: string;
  value: string;
  onChange: (path: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const url = photoUrl(value);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadGatePassPhoto(file, folder));
    } catch (e) {
      toast({ title: "Photo not uploaded", description: errorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <input id={id} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      {url ? (
        <div className="flex items-center gap-3">
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={label} className="h-24 w-24 rounded-lg object-cover border" />
          </a>
          <Button type="button" variant="outline" size="sm" disabled={busy} asChild>
            <label htmlFor={id} className="cursor-pointer">{busy ? "Uploading…" : "Retake"}</label>
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" className="w-full h-24 border-dashed flex-col gap-1" disabled={busy} asChild>
          <label htmlFor={id} className="cursor-pointer">
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
            <span className="text-sm">{busy ? "Uploading…" : label}</span>
          </label>
        </Button>
      )}
    </div>
  );
}
