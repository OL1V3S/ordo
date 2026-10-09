import { useTranslation } from "react-i18next";
import FilterBar from "../../../shared/ui/FilterBar";
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
  const forced = PANEL_ERRORS.has(error);
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

  const status = [];
  if (error) status.push({ id: "invalid", tone: "warning", text: t("activity:timeline.filters.invalid") });
  else if (chips.length > 0) {
    status.push({
      id: "summary", visuallyHidden: true,
      text: <>{t("activity:timeline.filters.activePrefix")}{" "}{chips.map((chip) => chip.label).join(" · ")}</>,
    });
  }

  const fields = <>
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
  </>;

  return (
    <FilterBar
      className="activity-timeline__filters"
      search={{
        label: t("activity:timeline.filters.searchLabel"), value: draft.q, maxLength: MAX_TIMELINE_SEARCH_LENGTH * 2,
        placeholder: t("activity:timeline.filters.searchPlaceholder"), invalid: error === "search",
        onChange: (value) => setField("q", value),
      }}
      toggle={{
        label: t("activity:timeline.filters.toggle"), hint: t("activity:timeline.filters.toggleHint"),
        panelId: PANEL_ID, hintId: PANEL_HINT_ID, forced, className: "activity-timeline__filters-toggle",
      }}
      periods={{
        label: t("activity:timeline.filters.periodLabel"), value: period, onChange: setPeriod,
        options: TIMELINE_PERIODS.map((option) => ({ value: option, label: t(`activity:timeline.filters.period.${option}`) })),
      }}
      fields={fields}
      chips={chips}
      showChips={active}
      chipsLabel={t("activity:timeline.filters.chipsLabel")}
      removeLabel={(chip) => t("activity:timeline.filters.remove", { label: chip.label })}
      onRemove={removeField}
      clearLabel={t("activity:timeline.filters.clear")}
      onClear={clear}
      status={status}
      statusClassName="activity-timeline__filter-status"
    />
  );
}
