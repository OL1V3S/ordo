import { useRef } from "react";
import { useTranslation } from "react-i18next";
import FormField from "../../../shared/ui/FormField";
import { MAX_TIMELINE_SEARCH_LENGTH, normalizeTimelineFilter } from "../utils/timelineFilter";

export default function ActivityTimelineFilters({ filters }) {
  const { t } = useTranslation(["activity", "home"]);
  const { draft, applied, error, active, setField, clear } = filters;
  const searchRef = useRef(null);
  const shown = normalizeTimelineFilter(applied);
  const summary = [
    shown.q ? t("activity:timeline.filters.summary.search", { term: shown.q }) : "",
    shown.kind ? t(shown.kind === "expense" ? "home:activity.expense" : "home:activity.cashIn") : "",
    shown.from ? t("activity:timeline.filters.summary.from", { date: shown.from }) : "",
    shown.to ? t("activity:timeline.filters.summary.to", { date: shown.to }) : "",
  ].filter(Boolean);

  return (
    <div className="activity-timeline__filters">
      <div className="filters activity-timeline__filter-fields">
        <FormField label={t("activity:timeline.filters.searchLabel")} className="activity-timeline__filter-search">
          {(id) => (
            <input id={id} ref={searchRef} type="search" value={draft.q} maxLength={MAX_TIMELINE_SEARCH_LENGTH * 2}
              placeholder={t("activity:timeline.filters.searchPlaceholder")}
              aria-invalid={error === "search" || undefined}
              onChange={(event) => setField("q", event.target.value)} />
          )}
        </FormField>
        <FormField label={t("activity:timeline.filters.kindLabel")}>
          {(id) => (
            <select id={id} value={draft.kind} onChange={(event) => setField("kind", event.target.value)}>
              <option value="">{t("activity:timeline.filters.kindAll")}</option>
              <option value="expense">{t("home:activity.expense")}</option>
              <option value="account_inflow">{t("home:activity.cashIn")}</option>
            </select>
          )}
        </FormField>
        <FormField label={t("activity:timeline.filters.fromLabel")}>
          {(id) => (
            <input id={id} type="date" value={draft.from} aria-invalid={error === "range" || undefined}
              onChange={(event) => setField("from", event.target.value)} />
          )}
        </FormField>
        <FormField label={t("activity:timeline.filters.toLabel")}>
          {(id) => (
            <input id={id} type="date" value={draft.to} aria-invalid={error === "range" || undefined}
              onChange={(event) => setField("to", event.target.value)} />
          )}
        </FormField>
        {active && <button type="button" className="button-ghost" onClick={() => { clear(); searchRef.current?.focus(); }}>
          {t("activity:timeline.filters.clear")}
        </button>}
      </div>
      <div className="activity-timeline__filter-status" aria-live="polite">
        {error && <p className="status-message status-message--warning">{t("activity:timeline.filters.invalid")}</p>}
        {!error && summary.length > 0 && <p className="muted">
          <span className="sr-only">{t("activity:timeline.filters.activePrefix")}{" "}</span>
          {summary.join(" · ")}
        </p>}
      </div>
    </div>
  );
}
