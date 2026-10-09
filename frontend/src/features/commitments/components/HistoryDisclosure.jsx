import { ChevronDown } from "lucide-react";
import { DisclosureButton, DisclosurePanel } from "../../../shared/ui/Disclosure";

// APG accordion shape: h2 > button (inline text only) controlling an adjacent panel. Page-owned
// open state; while `locked` the panel is forced open, the button is announced disabled and its
// description points at the visible lock note (`lockNoteId`) rendered inside the panel.
export default function HistoryDisclosure({ headingId, panelId, lockNoteId, title, count, open, locked = false, onToggle, className = "", children }) {
  return (
    <section className={`commitment-history ${className}`.trim()} aria-labelledby={headingId}>
      <h2 id={headingId} className="commitment-history__heading">
        <DisclosureButton controls={panelId} open={open} forced={locked} hintId={lockNoteId} onToggle={onToggle} className="commitment-history__button">
          <span>{title} <span className="commitment-history__count">({count})</span></span>
          <ChevronDown className="commitment-history__chevron" size={18} aria-hidden="true" />
        </DisclosureButton>
      </h2>
      <DisclosurePanel id={panelId} open={open} className="commitment-history__content">{children}</DisclosurePanel>
    </section>
  );
}
