import { useEffect, useRef } from "react";

// Labelled task container. When it opens, focus moves to `initialFocusRef` (or the container),
// unless `autoFocus` is false (the caller's tasks already own their focus).
export default function TaskArea({ id, open, label, labelledBy, initialFocusRef, autoFocus = true, className = "", children }) {
  const areaRef = useRef(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current && autoFocus) {
      const frame = requestAnimationFrame(() => (initialFocusRef?.current ?? areaRef.current)?.focus());
      wasOpen.current = open;
      return () => cancelAnimationFrame(frame);
    }
    wasOpen.current = open;
    return undefined;
  }, [open, initialFocusRef, autoFocus]);
  return (
    <section id={id} ref={areaRef} tabIndex={-1} hidden={!open} aria-label={label} aria-labelledby={labelledBy}
      className={`ui-task-area ${className}`.trim()}>
      {children}
    </section>
  );
}
