// Share a PDF blob to WhatsApp (and other apps).
//
// On mobile with the Web Share API (level 2) this opens the native share sheet
// where WhatsApp appears, letting the user send the file straight to a contact.
// On desktop / unsupported browsers it falls back to downloading the PDF and
// opening WhatsApp with a summary note so the user can attach it manually.

export type SharePdfResult = "shared" | "downloaded" | "cancelled";

export async function shareOrDownloadPdf(args: {
  blob: Blob;
  fileName: string;
  title: string;
  text: string;
}): Promise<SharePdfResult> {
  const { blob, fileName, title, text } = args;
  const file = new File([blob], fileName, { type: "application/pdf" });

  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };

  if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title, text });
      return "shared";
    } catch (e) {
      // User dismissing the native share sheet throws AbortError - not an error.
      if ((e as { name?: string })?.name === "AbortError") return "cancelled";
      throw e;
    }
  }

  // Fallback: download the file, then open WhatsApp with a summary note.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  window.open(
    `https://wa.me/?text=${encodeURIComponent(text + "\n\n(PDF downloaded - attach it in WhatsApp)")}`,
    "_blank"
  );
  return "downloaded";
}
