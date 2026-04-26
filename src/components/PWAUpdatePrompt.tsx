import { useEffect, useRef } from "react";
import { toast } from "sonner";

const PWA_UPDATE_EVENT = "pwa-update-available";
const PWA_APPLY_UPDATE_EVENT = "pwa-apply-update";

export function PWAUpdatePrompt() {
  const toastIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    const showUpdateToast = () => {
      if (toastIdRef.current) return;

      toastIdRef.current = toast("A new version is available", {
        description: "Reload to get the latest updates.",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => {
            window.dispatchEvent(new CustomEvent(PWA_APPLY_UPDATE_EVENT));
          },
        },
      });
    };

    window.addEventListener(PWA_UPDATE_EVENT, showUpdateToast);

    return () => {
      window.removeEventListener(PWA_UPDATE_EVENT, showUpdateToast);

      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
    };
  }, []);

  return null;
}
