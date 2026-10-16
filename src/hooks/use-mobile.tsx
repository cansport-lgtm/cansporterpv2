import * as React from "react";

const MOBILE_BREAKPOINT = 768;

const readIsMobile = () =>
  typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false;

/**
 * True below the `md` breakpoint (768px).
 * The initial value is read synchronously so the first paint already uses the
 * correct layout instead of flashing the desktop one on phones.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(readIsMobile);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
