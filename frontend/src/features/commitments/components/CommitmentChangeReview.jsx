import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import ListRow from "../../../shared/ui/ListRow";
import SectionHeader from "../../../shared/ui/SectionHeader";
import HistoryDisclosure from "./HistoryDisclosure";
import CommitmentEvidence from "./CommitmentEvidence";
import { cadenceLabel, formatDate, formatDerivedMoney, formatMoney, weekdayLabel } from "../utils/formatCommitments";
import groupCommitmentChanges from "../utils/groupCommitmentChanges";
import { displayText } from "../../../utils/text";
import { parseExpenseAmount } from "../../expenses/utils/exactMoney";

function timingSummary(model, t) {
  const window = {
    before: t("timing.compact.before", { count: Number(model.windowBeforeDays) }),
    after: t("timing.compact.after", { count: Number(model.windowAfterDays) }),
  };
  if (model.cadence === "weekly") return t("timing.compact.weekly", { weekday: weekdayLabel(model.expectedDayOfWeek, t), ...window });
  if (model.cadence === "monthly" && model.timingKind === "monthend") return t("timing.compact.monthEnd", window);
  if (model.cadence === "yearly") return t("timing.compact.yearly", { month: model.expectedMonth, day: model.expectedDay, ...window });
  return t("timing.compact.dayOfMonth", { day: model.expectedDay, ...window });
}

function amountSummary(model, locale) {
  if (model.amountMode === "fixed") return formatMoney(model.expectedAmount, locale);
  return `${formatMoney(model.expectedMinimumAmount, locale)}–${formatMoney(model.expectedMaximumAmount, locale)}`;
}

function proposedAmountSummary(assessment, locale) {
  if (assessment.proposedMode === "fixed") return formatDerivedMoney(assessment.proposedAmount, locale);
  return `${formatDerivedMoney(assessment.proposedMinimumAmount, locale)}–${formatDerivedMoney(assessment.proposedMaximumAmount, locale)}`;
}

function proposedTimingSummary(commitment, assessment, t) {
  return timingSummary({
    cadence: commitment.cadence,
    timingKind: assessment.proposedTimingKind,
    expectedDayOfWeek: assessment.proposedDayOfWeek,
    expectedDay: assessment.proposedDay,
    expectedMonth: assessment.proposedMonth,
    windowBeforeDays: assessment.proposedWindowBeforeDays,
    windowAfterDays: assessment.proposedWindowAfterDays,
  }, t);
}

function evidenceFor(change, assessment) {
  const ids = new Set(assessment.evidenceExpenseIds ?? []);
  return change.observations.filter((observation) => ids.has(observation.expenseId));
}

function exactAmountAssessmentAvailable(change, assessment) {
  const proposedAvailable = assessment.proposedMode === "fixed"
    ? Boolean(parseExpenseAmount(assessment.proposedAmount))
    : assessment.proposedMode === "range"
      && Boolean(parseExpenseAmount(assessment.proposedMinimumAmount))
      && Boolean(parseExpenseAmount(assessment.proposedMaximumAmount));
  const evidenceIds = new Set(assessment.evidenceExpenseIds ?? []);
  const evidence = evidenceFor(change, assessment);
  return proposedAvailable && evidenceIds.size > 0 && evidence.length === evidenceIds.size
    && evidence.every((observation) => parseExpenseAmount(observation.amount));
}

const MISSING_CADENCES = ["weekly", "monthly", "yearly"];

function explanation(change, dimension, assessment, t) {
  if (dimension === "missing") {
    const count = assessment.missedSlotAnchors.length;
    const cadence = MISSING_CADENCES.includes(change.commitment.cadence) ? change.commitment.cadence : "other";
    return t(`changes.explanation.missing.${cadence}`, { count });
  }
  const count = assessment.evidenceExpenseIds.length;
  return t(`changes.explanation.${dimension}`, { count });
}

function Comparison({ change, dimension, assessment }) {
  const { t } = useTranslation("commitments");
  const { locale } = useLocale();
  if (dimension === "missing") {
    return (
      <div className="commitment-change__missing">
        <strong>{assessment.state === "possibly_ended" ? t("changes.possiblyEnded") : t("changes.notSeen")}</strong>
        <span>{t("changes.observationNote")}</span>
        <ul>
          {assessment.missedSlotAnchors.map((anchor) => <li key={anchor}>{formatDate(anchor, t, locale)}</li>)}
        </ul>
      </div>
    );
  }

  const current = dimension === "amount"
    ? amountSummary(change.commitment, locale)
    : timingSummary(change.commitment, t);
  const proposed = dimension === "amount"
    ? proposedAmountSummary(assessment, locale)
    : proposedTimingSummary(change.commitment, assessment, t);
  return (
    <dl className="commitment-change__comparison">
      <div><dt>{t("changes.currentExpectation")}</dt><dd>{current}</dd></div>
      <div><dt>{t("changes.observedChange")}</dt><dd>{proposed}</dd></div>
    </dl>
  );
}

function ChangeActions({ change, dimension, assessment, state, kept, activeTask, onTaskChange, onReviewedOpenChange }) {
  const { t } = useTranslation("commitments");
  const endTriggerRef = useRef(null);
  const confirmEndRef = useRef(null);
  const restoreEndFocus = useRef(false);
  const name = change.commitment.name;
  const taskKey = `${change.commitment.id}:${assessment.fingerprint}`;
  const confirmingEnd = activeTask?.mode === "change-end" && activeTask.key === taskKey;
  const exactAmountAvailable = dimension !== "amount" || exactAmountAssessmentAvailable(change, assessment);
  const actionDisabled = Boolean(state.busyKey || state.loading || state.loadError || activeTask || !exactAmountAvailable);
  const confirmationDisabled = Boolean(state.busyKey || state.loading || state.loadError);
  const cancelDisabled = Boolean(state.busyKey || state.loading);

  useEffect(() => {
    if (confirmingEnd) {
      confirmEndRef.current?.focus();
    } else if (restoreEndFocus.current) {
      restoreEndFocus.current = false;
      const endTrigger = endTriggerRef.current;
      if (endTrigger && !endTrigger.disabled) endTrigger.focus();
      else document.getElementById("commitments-feedback")?.focus();
    }
  }, [confirmingEnd]);

  async function run(operation, focusId, openReviewed = false) {
    await operation();
    if (openReviewed) onReviewedOpenChange(true);
    const activeAfterOperation = document.activeElement;
    requestAnimationFrame(() => {
      const activeNow = document.activeElement;
      if (activeNow !== activeAfterOperation && activeNow?.isConnected && activeNow !== document.body) return;
      const feedback = document.getElementById("commitments-feedback");
      const hasError = feedback?.matches('[role="alert"]') || feedback?.querySelector('[role="alert"]');
      if (hasError) feedback.focus();
      else {
        const target = document.getElementById(focusId);
        (focusId === "kept-changes-heading" ? target?.querySelector(":scope > .ui-disclosure__button") ?? target : target)?.focus();
      }
    });
  }

  if (kept) {
    return (
      <div className="inline-actions commitment-change__actions">
        <button
          type="button"
          disabled={actionDisabled}
          aria-label={t(`changes.reconsiderLabel.${dimension}`, { name })}
          onClick={() => run(
            () => state.reconsiderChange(change.commitment.id, dimension, assessment.fingerprint),
            "changes-review-heading"
          )}
        >
          {state.busyKey ? t("changes.updating") : t("changes.reconsider")}
        </button>
      </div>
    );
  }

  if (dimension === "missing" && confirmingEnd) {
    const confirmationId = `end-confirmation-${change.commitment.id}`;
    return (
      <div className="commitment-change__confirmation" role="group" aria-labelledby={confirmationId}>
        <p id={confirmationId}>
          {t("changes.markEndedPrompt", { name })}
        </p>
        <div className="inline-actions">
          <button
            ref={confirmEndRef}
            type="button"
            className="button-danger"
            disabled={confirmationDisabled}
            aria-label={t("changes.confirmMarkEndedLabel", { name })}
            onClick={() => run(
              () => state.markEndedFromChange(change.commitment.id, assessment.fingerprint),
              "changes-review-heading"
            )}
          >
            {state.busyKey ? t("changes.markingEnded") : t("changes.confirmMarkEnded")}
          </button>
          <button
            type="button"
            className="button-ghost"
            disabled={cancelDisabled}
            aria-label={t("changes.cancelMarkEndedLabel", { name })}
            onClick={() => {
              restoreEndFocus.current = true;
              onTaskChange(null);
            }}
          >
            {t("changes.cancelMarkEnded")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inline-actions commitment-change__actions">
      {dimension === "amount" && (
        <button
          type="button"
          disabled={actionDisabled}
          aria-label={t("changes.acceptLabel.amount", { name })}
          onClick={() => run(
            () => state.acceptAmountChange(change.commitment.id, assessment.fingerprint),
            "changes-review-heading"
          )}
        >
          {state.busyKey ? t("changes.updating") : t("changes.accept")}
        </button>
      )}
      {dimension === "timing" && (
        <button
          type="button"
          disabled={actionDisabled}
          aria-label={t("changes.acceptLabel.timing", { name })}
          onClick={() => run(
            () => state.acceptTimingChange(change.commitment.id, assessment.fingerprint),
            "changes-review-heading"
          )}
        >
          {state.busyKey ? t("changes.updating") : t("changes.accept")}
        </button>
      )}
      <button
        type="button"
        className="button-ghost"
        disabled={actionDisabled}
        aria-label={t(`changes.keepCurrentLabel.${dimension}`, { name })}
        onClick={() => run(
          () => state.keepChange(change.commitment.id, dimension, assessment.fingerprint),
          "kept-changes-heading",
          true
        )}
      >
        {state.busyKey ? t("changes.updating") : dimension === "missing" ? t("changes.keepActive") : t("changes.keepCurrent")}
      </button>
      {dimension === "missing" && assessment.state === "possibly_ended" && (
        <button
          ref={endTriggerRef}
          type="button"
          className="button-danger"
          disabled={actionDisabled}
          aria-label={t("changes.markEndedLabel", { name })}
          onClick={() => onTaskChange({ mode: "change-end", key: taskKey })}
        >
          {t("changes.markEnded")}
        </button>
      )}
    </div>
  );
}

function ChangeCard({ change, state, kept, activeTask, onTaskChange, onReviewedOpenChange }) {
  const { t } = useTranslation("commitments");
  const { locale } = useLocale();
  return (
    <ListRow className={`commitment-row commitment-change-row${kept ? " commitment-change-row--kept" : ""}`} titleAs="h3"
      label={kept ? t("changes.eyebrowReviewed") : t("changes.eyebrowPending")} title={change.commitment.name}
      meta={<span>{displayText(change.commitment.category)} · {cadenceLabel(change.commitment.cadence, t)}</span>}>
      <div className="commitment-change__panels">
        {change.assessments.map(({ dimension, assessment }) => {
          const evidence = evidenceFor(change, assessment);
          const exactAmountAvailable = dimension !== "amount"
            || exactAmountAssessmentAvailable(change, assessment);
          return (
            <section className="commitment-change__panel" key={`${dimension}:${assessment.fingerprint}`}>
              <div className="commitment-change__panel-header">
                <div>
                  <p className="commitment-change__dimension">{t(`changes.dimension.${dimension}`)}</p>
                  <h4>{explanation(change, dimension, assessment, t)}</h4>
                </div>
                <span className={`commitment-change__status commitment-change__status--${kept ? "kept" : "pending"}`}>
                  {kept ? t("changes.statusKept") : t("changes.statusPending")}
                </span>
              </div>
              <Comparison change={change} dimension={dimension} assessment={assessment} />
              {!exactAmountAvailable && <p className="muted">{t("changes.exactUnavailable")}</p>}
              <details className="commitment-change__details">
                <summary aria-label={t(`changes.detailsLabel.${dimension}`, { name: change.commitment.name })}>{t("changes.details")}</summary>
                {evidence.length > 0 && <CommitmentEvidence evidence={evidence} />}
                <dl className="commitment-change__mechanics">
                  <div><dt>{t("changes.evaluated")}</dt><dd>{formatDate(state.changeEvaluatedOn, t, locale)}</dd></div>
                  <div><dt>{t("changes.detectionDetails")}</dt><dd>{change.algorithmVersion}</dd></div>
                </dl>
              </details>
              <ChangeActions change={change} dimension={dimension} assessment={assessment} state={state} kept={kept}
                activeTask={activeTask} onTaskChange={onTaskChange} onReviewedOpenChange={onReviewedOpenChange} />
            </section>
          );
        })}
      </div>
    </ListRow>
  );
}

function changeCount(changes) {
  return changes.reduce((count, change) => count + change.assessments.length, 0);
}

function ChangeList({ changes, state, kept = false, activeTask, onTaskChange, onReviewedOpenChange }) {
  const { t } = useTranslation("commitments");
  if (changes.length === 0) return <p className="empty-state">{kept ? t("changes.emptyReviewed") : t("changes.emptyPending")}</p>;
  return (
    <ul className="commitment-rows">
      {changes.map((change) => (
        <ChangeCard key={change.commitment.id} change={change} state={state} kept={kept}
          activeTask={activeTask} onTaskChange={onTaskChange} onReviewedOpenChange={onReviewedOpenChange} />
      ))}
    </ul>
  );
}

function PendingChanges({ changes, state, activeTask, onTaskChange, onReviewedOpenChange }) {
  const { t } = useTranslation("commitments");
  return (
    <section className="commitment-section" aria-labelledby="changes-review-heading">
      <SectionHeader id="changes-review-heading" focusable title={t("changes.heading")} action={<span className="commitment-count">{changeCount(changes)}</span>} />
      <p className="muted">{t("changes.intro")}</p>
      <ChangeList changes={changes} state={state} activeTask={activeTask}
        onTaskChange={onTaskChange} onReviewedOpenChange={onReviewedOpenChange} />
    </section>
  );
}

function ReviewedChanges({ changes, state, activeTask, onTaskChange, open, onOpenChange, onReviewedOpenChange }) {
  const { t } = useTranslation("commitments");
  const locked = Boolean(state.busyKey?.includes(":reconsider:"));
  return (
    <HistoryDisclosure className="commitment-change-history" headingId="kept-changes-heading" panelId="commitments-reviewed-panel" lockNoteId="commitments-reviewed-lock-note"
      title={t("changes.reviewedHeading")} count={changeCount(changes)} open={open || locked} locked={locked} onToggle={() => onOpenChange(!open)}>
      <p className="muted">{t("changes.reviewedIntro")}</p>
      {locked && <p id="commitments-reviewed-lock-note" className="muted">{t("changes.reviewedLocked")}</p>}
      <ChangeList changes={changes} state={state} kept activeTask={activeTask}
        onTaskChange={onTaskChange} onReviewedOpenChange={onReviewedOpenChange} />
    </HistoryDisclosure>
  );
}

export default function CommitmentChangeReview({
  state,
  view = "all",
  activeTask: controlledActiveTask,
  onTaskChange,
  reviewedOpen: controlledReviewedOpen,
  onReviewedOpenChange,
}) {
  const [localActiveTask, setLocalActiveTask] = useState(null);
  const [localReviewedOpen, setLocalReviewedOpen] = useState(false);
  const activeTask = controlledActiveTask === undefined ? localActiveTask : controlledActiveTask;
  const changeTask = onTaskChange ?? setLocalActiveTask;
  const reviewedOpen = controlledReviewedOpen === undefined ? localReviewedOpen : controlledReviewedOpen;
  const changeReviewedOpen = onReviewedOpenChange ?? setLocalReviewedOpen;
  const pending = groupCommitmentChanges(state.commitmentChanges, "pending");
  const kept = groupCommitmentChanges(state.commitmentChanges, "kept");

  useEffect(() => {
    if (view === "reviewed" || activeTask?.mode !== "change-end") return;
    const exists = pending.some((change) => change.assessments.some(({ assessment }) =>
      `${change.commitment.id}:${assessment.fingerprint}` === activeTask.key));
    if (!exists) changeTask(null);
  }, [activeTask, changeTask, pending, view]);

  return (
    <>
      {(view === "all" || view === "pending") && <PendingChanges changes={pending} state={state} activeTask={activeTask}
        onTaskChange={changeTask} onReviewedOpenChange={changeReviewedOpen} />}
      {(view === "all" || view === "reviewed") && <ReviewedChanges changes={kept} state={state} activeTask={activeTask}
        onTaskChange={changeTask} open={reviewedOpen} onOpenChange={changeReviewedOpen}
        onReviewedOpenChange={changeReviewedOpen} />}
    </>
  );
}
