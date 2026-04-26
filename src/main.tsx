import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";

const ERP_SESSION_KEY = "erp_session";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_REGEX.test(value);

const clearMalformedStoredSessions = () => {
  try {
    const erpSessionRaw = window.localStorage.getItem(ERP_SESSION_KEY);
    if (erpSessionRaw) {
      try {
        const parsed = JSON.parse(erpSessionRaw);
        if (!isValidUuid(parsed?.userUuid)) {
          window.localStorage.removeItem(ERP_SESSION_KEY);
        }
      } catch {
        window.localStorage.removeItem(ERP_SESSION_KEY);
      }
    }

    const authKeysToRemove: string[] = [];

    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;

      const rawValue = window.localStorage.getItem(key);
      if (!rawValue) continue;

      try {
        const parsed = JSON.parse(rawValue);
        const accessToken = parsed?.access_token;
        const refreshToken = parsed?.refresh_token;
        const userId = parsed?.user?.id ?? parsed?.currentSession?.user?.id;

        if (
          (userId && !isValidUuid(userId)) ||
          (accessToken && typeof accessToken !== "string") ||
          (refreshToken && typeof refreshToken !== "string")
        ) {
          authKeysToRemove.push(key);
        }
      } catch {
        authKeysToRemove.push(key);
      }
    }

    authKeysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Ignore storage access issues during bootstrap
  }
};

const PWA_UPDATE_EVENT = "pwa-update-available";
const PWA_APPLY_UPDATE_EVENT = "pwa-apply-update";

const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

const unregisterPreviewServiceWorkers = async () => {
  if (!("serviceWorker" in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  if (!("caches" in window)) return;

  const cacheKeys = await window.caches.keys();
  await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)));
};

const setupServiceWorker = () => {
  if (!("serviceWorker" in navigator)) return;

  if (isInIframe || isPreviewHost) {
    void unregisterPreviewServiceWorkers();
    return;
  }

  let isReloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (isReloading) return;
    isReloading = true;
    window.location.reload();
  });

  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdates = () => registration.update().catch(() => undefined);

      checkForUpdates();
      window.setInterval(checkForUpdates, 5 * 60 * 1000);

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          checkForUpdates();
        }
      });

      window.addEventListener("focus", checkForUpdates);
      window.addEventListener("online", checkForUpdates);
    },
    onRegisterError(error) {
      console.warn("SW registration error", error);
    },
  });

  window.addEventListener(PWA_APPLY_UPDATE_EVENT, () => {
    void updateServiceWorker(true);
  });
};

const bootstrap = async () => {
  clearMalformedStoredSessions();
  setupServiceWorker();
  const [{ default: App }] = await Promise.all([import("./App.tsx")]);
  createRoot(document.getElementById("root")!).render(<App />);
};

bootstrap();
