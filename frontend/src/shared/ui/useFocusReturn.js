import { useRef } from "react";

// Remember the opener of a task and restore focus to it afterwards (fallback when it is gone/disabled).
export default function useFocusReturn() {
  const opener = useRef(null);
  return {
    remember(element = document.activeElement) { opener.current = element; },
    restore(fallbackRef) {
      const element = opener.current;
      opener.current = null;
      const usable = element && element.isConnected && !element.disabled;
      (usable ? element : fallbackRef?.current)?.focus();
    },
  };
}
