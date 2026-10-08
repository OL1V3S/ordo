import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FormField from "../../../shared/ui/FormField";
import { MAX_TIMELINE_SEARCH_LENGTH, TIMELINE_PERIODS, normalizeTimelineFilter } from "../utils/timelineFilter";

const PANEL_ID = "activity-timeline-filter-panel";
const PANEL_HINT_ID = "activity-timeline-filter-hint";
const PRESET_PERIODS = new Set(["last7", "last30", "thisMonth"]);
// Errors the closed panel would hide: the invalid field must be visible, so the panel stays open.
const PANEL_ERRORS = new Set(["date", "range", "kind"]);

export default function ActivityTimelineFilters({ filters }) {
  const { t } = useTranslation(["activity", "home"]);
  const { draft, applied, error, period, presetRange, active, setField, setPeriod, removeField, clear } = filters;
  const [userOpen, setUserOpen] = useState(false);
  const searchRef = useRef(null);
  const chipsRef = useRef(null);
  const pendingFocus = useRef(null);
  const forced = PANEL_ERRORS.has(error);
  const open = userOpen || forced;
  const shown = normalizeTimelineFilter(applied);
  const presetApplied = PRESET_PERIODS.has(period) && presetRange
    && presetRange.from === shown.from && presetRange.to === shown.to;
  const chips = [];
  if (shown.q) chips.push({ key: "q", label: t("activity:timeline.filters.summary.search", { term: shown.q }) });
  if (shown.kind) chips.push({ key: "kind", label: t(shown.kind === "expense" ? "home:activity.expense" : "home:activity.cashIn") });
  if (presetApplied) chips.push({ key: "period", label: t(`activity:timeline.filters.period.${period}`) });
  else {
    if (shown.from) chips.push({ key: "from", label: t("activity:timeline.filters.summary.from", { date: shown.from }) });
    if (shown.to) chips.push({ key: "to", label: t("activity:timeline.filters.summary.to", { date: shown.to }) });
  }

  useEffect(() => { if (forced) setUserOpen(true); }, [forced]);
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const button = target === "search" ? searchRef.current
      : chipsRef.current?.querySelector(`[data-chip-remove="${target}"]`);
    (button ?? searchRef.current)?.focus();
  });

  function removeChip(key) {
    const index = chips.findIndex((chip) => chip.key === key);
    pendingFocus.current = (chips[index + 1] ?? chips[index - 1])?.key ?? "search";
    removeField(key);
  }

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
        <button type="button" className="button-ghost activity-timeline__filters-toggle" aria-expanded={open}
          aria-controls={PANEL_ID} aria-disabled={forced || undefined} aria-describedby={forced ? PANEL_HINT_ID : undefined}
          onClick={() => { if (!forced) setUserOpen((current) => !current); }}>
          {t("activity:timeline.filters.toggle")}
        </button>
        {forced && <span id={PANEL_HINT_ID} className="sr-only">{t("activity:timeline.filters.toggleHint")}</span>}
      </div>
      <div id={PANEL_ID} hidden={!open} className="activity-timeline__filter-panel">
        <div role="group" aria-label={t("activity:timeline.filters.periodLabel")} className="activity-timeline__periods">
          <span className="activity-timeline__periods-label" aria-hidden="true">{t("activity:timeline.filters.periodLabel")}</span>
          {TIMELINE_PERIODS.map((option) => (
            <button key={option} type="button" className="button-ghost activity-timeline__period"
              aria-pressed={period === option} onClick={() => setPeriod(option)}>
              {t(`activity:timeline.filters.period.${option}`)}
            </button>
          ))}
        </div>
        <div className="filters activity-timeline__filter-fields">
          {period === "custom" && <>
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
          </>}
          <FormField label={t("activity:timeline.filters.kindLabel")}>
            {(id) => (
              <select id={id} value={draft.kind} onChange={(event) => setField("kind", event.target.value)}>
                <option value="">{t("activity:timeline.filters.kindAll")}</option>
                <option value="expense">{t("home:activity.expense")}</option>
                <option value="account_inflow">{t("home:activity.cashIn")}</option>
              </select>
            )}
          </FormField>
        </div>
      </div>
      {active && <div className="activity-timeline__chips" ref={chipsRef} role="group" aria-label={t("activity:timeline.filters.chipsLabel")}>
        {chips.map((chip) => (
          <span key={chip.key} className="activity-timeline__chip">
            <span>{chip.label}</span>
            <button type="button" data-chip-remove={chip.key} className="activity-timeline__chip-remove"
              aria-label={t("activity:timeline.filters.remove", { label: chip.label })} onClick={() => removeChip(chip.key)}>
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}
        <button type="button" className="button-ghost" onClick={() => { clear(); searchRef.current?.focus(); }}>
          {t("activity:timeline.filters.clear")}
        </button>
      </div>}
      <div className="activity-timeline__filter-status" aria-live="polite">
        {error && <p className="status-message status-message--warning">{t("activity:timeline.filters.invalid")}</p>}
        {!error && chips.length > 0 && <p className="sr-only">
          {t("activity:timeline.filters.activePrefix")}{" "}{chips.map((chip) => chip.label).join(" · ")}
        </p>}
      </div>
    </div>
  );
}
