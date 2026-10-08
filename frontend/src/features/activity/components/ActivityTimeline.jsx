import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import ActivityTimelineFilters from "./ActivityTimelineFilters";
import StatusMessage from "../../../shared/ui/StatusMessage";
import { isTimelineFilterActive } from "../utils/timelineFilter";
import { formatTimelineAmount, formatTimelineDate, timelineItemKey } from "../utils/timelinePresentation";

export default function ActivityTimeline({ timeline, filters = null, uncertain = false, rowActions = null }) {
  const { t } = useTranslation(["activity", "home"]);
  const { locale } = useLocale();
  const moneyLocale = locale === "es" ? "es-US" : "en-US";
  const headingRef = useRef(null);
  const moreButtonRef = useRef(null);
  const moreRequested = useRef(false);
  const {
    items, hasMore, loading, error, refreshFailed, malformed, loadingMore, loadMoreFailed, loadMore, refresh,
  } = timeline;

  // After "Show older activity" finishes, focus stays on the button while more pages remain
  // and moves to the heading once the oldest record has been loaded.
  useEffect(() => {
    if (!moreRequested.current || loadingMore) return;
    moreRequested.current = false;
    (hasMore ? moreButtonRef : headingRef).current?.focus();
  }, [hasMore, loadingMore, items]);

  function showOlder() {
    if (loadingMore) return;
    moreRequested.current = true;
    Promise.resolve(loadMore()).then((result) => {
      if (result?.stale) moreRequested.current = false;
    });
  }

  const showRows = items.length > 0 && !malformed;
  // Chosen from the filter the committed rows were read under, never from the draft controls.
  const noMatches = isTimelineFilterActive(timeline.appliedFilter);
  const settled = !loading && !error && !malformed;

  return (
    <section id="activity-timeline" className="activity-timeline" aria-labelledby="activity-timeline-heading"
      aria-busy={loading || loadingMore}>
      <h2 id="activity-timeline-heading" ref={headingRef} tabIndex={-1}>{t("activity:timeline.heading")}</h2>
      <p className="muted">{t("activity:timeline.intro")}</p>
      {filters && <ActivityTimelineFilters filters={filters} />}
      {loading && <StatusMessage>{t(showRows ? "activity:timeline.refreshing" : "activity:timeline.loading")}</StatusMessage>}
      {error && <div className="activity-timeline__notice">
        <StatusMessage tone="danger">{t("activity:timeline.unavailable")}</StatusMessage>
        <button type="button" onClick={() => void refresh()}>{t("activity:timeline.retry")}</button>
      </div>}
      {malformed && <div className="activity-timeline__notice">
        <StatusMessage tone="danger">{t("activity:timeline.malformed")}</StatusMessage>
        <button type="button" onClick={() => void refresh()}>{t("activity:timeline.retry")}</button>
      </div>}
      {refreshFailed && <div className="activity-timeline__notice">
        <StatusMessage tone="warning">{t("activity:timeline.refreshFailed")}</StatusMessage>
        <button type="button" onClick={() => void refresh()}>{t("activity:timeline.retry")}</button>
      </div>}
      {/* Always mounted so assistive technology is already watching it when the notice appears. */}
      <div className="activity-timeline__live" aria-live="polite">
        {uncertain && <p className="status-message status-message--warning">{t("activity:timeline.maybeStale")}</p>}
      </div>
      {settled && !refreshFailed && items.length === 0 && <p className="muted">{t(noMatches ? "activity:timeline.filters.noMatches" : "activity:timeline.empty")}</p>}
      {showRows && <ul className="activity-timeline__list" aria-label={t("activity:timeline.listLabel")}>
        {items.map((item) => {
          const amount = formatTimelineAmount(item.amount, item.kind, moneyLocale);
          const date = formatTimelineDate(item.date, moneyLocale);
          const actionState = rowActions?.getState(item);
          const labelValues = { description: item.description, date: date ?? t("home:activity.dateUnknown"), id: item.recordId };
          const expenseRow = item.kind === "expense";
          return (
            <li key={timelineItemKey(item)} className={`activity-timeline__row activity-timeline__row--${item.kind}`}>
              <div className="activity-timeline__main">
                <span className="activity-timeline__kind">
                  {t(item.kind === "expense" ? "home:activity.expense" : "home:activity.cashIn")}
                </span>
                <strong className="activity-timeline__description">{item.description}</strong>
                <p className="activity-timeline__meta">
                  {date ? <time dateTime={item.date}>{date}</time> : t("home:activity.dateUnknown")}
                  {item.kind === "expense" && item.category && <> · {item.category}</>}
                  {item.paycheck && <> · {t("home:activity.paycheckLinked")}</>}
                </p>
              </div>
              <div className="activity-timeline__amount">
                {amount ? <strong>{amount}</strong> : <>
                  <strong>{t("home:activity.amountReview")}</strong>
                  <span className="activity-timeline__stored-amount">{item.amount}</span>
                </>}
              </div>
              {actionState && <div className="activity-timeline__actions">
                <button type="button" disabled={!actionState.canEdit}
                  aria-label={t(expenseRow ? "activity:timeline.actions.editExpense" : "activity:timeline.actions.editCashIn", labelValues)}
                  onClick={(event) => rowActions.onEdit(item, event.currentTarget)}>{t("activity:timeline.actions.edit")}</button>
                <button type="button" className={expenseRow ? "button-danger" : "button-ghost"} disabled={!actionState.canDelete}
                  aria-label={t(expenseRow ? "activity:timeline.actions.deleteExpense" : "activity:timeline.actions.deleteCashIn", labelValues)}
                  onClick={(event) => rowActions.onDelete(item, event.currentTarget)}>{t("activity:timeline.actions.delete")}</button>
              </div>}
            </li>
          );
        })}
      </ul>}
      {showRows && loadMoreFailed && <StatusMessage tone="warning">{t("activity:timeline.loadMoreFailed")}</StatusMessage>}
      {showRows && hasMore && <button type="button" ref={moreButtonRef} className="button-ghost"
        aria-disabled={loadingMore || undefined} onClick={showOlder}>
        {t(loadingMore ? "activity:timeline.loadingMore" : loadMoreFailed ? "activity:timeline.retryMore" : "activity:timeline.showOlder")}
      </button>}
      {showRows && !hasMore && settled && <p className="muted">{t("activity:timeline.end")}</p>}
    </section>
  );
}
