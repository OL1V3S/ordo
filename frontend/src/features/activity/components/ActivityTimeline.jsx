import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import ActivityTimelineFilters from "./ActivityTimelineFilters";
import RowActionsMenu from "./RowActionsMenu";
import EmptyState from "../../../shared/ui/EmptyState";
import ListRow from "../../../shared/ui/ListRow";
import SectionHeader from "../../../shared/ui/SectionHeader";
import StatusMessage from "../../../shared/ui/StatusMessage";
import StatusStrip from "../../../shared/ui/StatusStrip";
import { isTimelineFilterActive } from "../utils/timelineFilter";
import { formatTimelineAmount, formatTimelineDate, timelineItemKey } from "../utils/timelinePresentation";

export default function ActivityTimeline({ timeline, filters = null, uncertain = false, rowActions = null }) {
  const { t } = useTranslation(["activity", "home"]);
  const { locale } = useLocale();
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
      <SectionHeader id="activity-timeline-heading" headingRef={headingRef} focusable title={t("activity:timeline.heading")} />
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
      <StatusStrip className="activity-timeline__live"
        messages={uncertain ? [{ id: "maybeStale", tone: "warning", text: t("activity:timeline.maybeStale") }] : []} />
      {settled && !refreshFailed && items.length === 0 && <EmptyState>{t(noMatches ? "activity:timeline.filters.noMatches" : "activity:timeline.empty")}</EmptyState>}
      {showRows && <ul className="activity-timeline__list" aria-label={t("activity:timeline.listLabel")}>
        {items.map((item) => {
          const amount = formatTimelineAmount(item.amount, item.kind, locale);
          const date = formatTimelineDate(item.date, locale);
          const actionState = rowActions?.getState(item);
          const labelValues = { description: item.description, date: date ?? t("home:activity.dateUnknown"), id: item.recordId };
          return (
            <ListRow key={timelineItemKey(item)} className={`activity-timeline__row activity-timeline__row--${item.kind}`}
              label={t(item.kind === "expense" ? "home:activity.expense" : "home:activity.cashIn")}
              title={item.description}
              meta={<>
                {date ? <time dateTime={item.date}>{date}</time> : t("home:activity.dateUnknown")}
                {item.kind === "expense" && item.category && <> · {item.category}</>}
                {item.paycheck && <> · {t("home:activity.paycheckLinked")}</>}
              </>}
              amount={amount ? <strong>{amount}</strong> : <>
                <strong>{t("home:activity.amountReview")}</strong>
                <span className="activity-timeline__stored-amount">{item.amount}</span>
              </>}
              actions={actionState ? <RowActionsMenu kind={item.kind} labelValues={labelValues} state={actionState}
                onEdit={(opener) => rowActions.onEdit(item, opener)} onDelete={(opener) => rowActions.onDelete(item, opener)} /> : null} />
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
