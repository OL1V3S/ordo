import { useEffect, useState } from "react";

// Open state for a disclosure that can be forced open (a task, error, gate or recovery needs the
// content). Once forced, it stays open after the gate clears (user state is latched).
export function useForcedOpen(forced = false) {
  const [userOpen, setUserOpen] = useState(false);
  useEffect(() => { if (forced) setUserOpen(true); }, [forced]);
  return { open: userOpen || forced, toggle: () => setUserOpen((current) => !current) };
}
