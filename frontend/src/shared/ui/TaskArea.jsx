import { useEffect, useRef } from "react";

// Labelled task container. When it opens, focus moves to `initialFocusRef` (or the container).
export default function TaskArea({ id, open, label, labelledBy, initialFocusRef, className = "", children }) {
  const areaRef = useRef(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const frame = requestAnimationFrame(() => (initialFocusRef?.current ?? areaRef.current)?.focus());
      wasOpen.current = open;
      return () => cancelAnimationFrame(frame);
    }
    wasOpen.current = open;
    return undefined;
  }, [open, initialFocusRef]);
  return (
    <section id={id} ref={areaRef} tabIndex={-1} hidden={!open} aria-label={label} aria-labelledby={labelledBy}
      className={`ui-task-area ${className}`.trim()}>
      {children}
    </section>
  );
}
