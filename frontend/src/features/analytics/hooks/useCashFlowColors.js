import { useEffect, useState } from "react";

const fallbackColors = {
  paychecks: "#24776a", other: "#9b6525", spent: "#5458c9", text: "#181a20",
  limit: "#666873", grid: "#e7e8ec", border: "#8b8d94", surface: "#ffffff",
};

export function useCashFlowColors() {
  const [colors, setColors] = useState(fallbackColors);
  useEffect(() => {
    const root = document.documentElement;
    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    let active = true;
    const update = () => queueMicrotask(() => {
      if (!active) return;
      const styles = window.getComputedStyle(root);
      const next = Object.fromEntries(Object.entries(fallbackColors).map(([key, fallback]) => [
        key, styles.getPropertyValue(`--chart-${key}`).trim() || fallback,
      ]));
      setColors((previous) => Object.keys(next).every((key) => next[key] === previous[key]) ? previous : next);
    });
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    systemTheme?.addEventListener("change", update);
    update();
    return () => {
      active = false;
      observer.disconnect();
      systemTheme?.removeEventListener("change", update);
    };
  }, []);
  return colors;
}
