import { useEffect, useRef, useState } from "react";
import Card from "../../../shared/ui/Card";
import CommitmentEvidence from "./CommitmentEvidence";
import { formatDate, formatDerivedMoney, formatMoney } from "../utils/formatCommitments";
import groupCommitmentChanges from "../utils/groupCommitmentChanges";
import { displayText } from "../../../utils/text";
import { parseExpenseAmount } from "../../expenses/utils/exactMoney";

function title(value) {
  const text = value?.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2") ?? "";
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function timingSummary(model) {
  if (model.cadence === "weekly") {
    return `${title(model.expectedDayOfWeek)} · ${model.windowBeforeDays} days before / ${model.windowAfterDays} days after`;
  }
  if (model.cadence === "monthly" && model.timingKind === "monthend") {
    return `Month end · ${model.windowBeforeDays} days before / ${model.windowAfterDays} days after`;
  }
  if (model.cadence === "yearly") {
    return `Month ${model.expectedMonth}, day ${model.expectedDay} · ${model.windowBeforeDays} days before / ${model.windowAfterDays} days after`;
  }
  return `Day ${model.expectedDay} · ${model.windowBeforeDays} days before / ${model.windowAfterDays} days after`;
}

function amountSummary(model) {
  if (model.amountMode === "fixed") return formatMoney(model.expectedAmount);
  return `${formatMoney(model.expectedMinimumAmount)}–${formatMoney(model.expectedMaximumAmount)}`;
}

function proposedAmountSummary(assessment) {
  if (assessment.proposedMode === "fixed") return formatDerivedMoney(assessment.proposedAmount);
  return `${formatDerivedMoney(assessment.proposedMinimumAmount)}–${formatDerivedMoney(assessment.proposedMaximumAmount)}`;
}

function proposedTimingSummary(commitment, assessment) {
  return timingSummary({
    cadence: commitment.cadence,
    timingKind: assessment.proposedTimingKind,
    expectedDayOfWeek: assessment.proposedDayOfWeek,
    expectedDay: assessment.proposedDay,
    expectedMonth: assessment.proposedMonth,
    windowBeforeDays: assessment.proposedWindowBeforeDays,
    windowAfterDays: assessment.proposedWindowAfterDays,
  });
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

function explanation(change, dimension, assessment) {
  if (dimension === "missing") {
    const count = assessment.missedSlotAnchors.length;
    return `${count} expected ${change.commitment.cadence} date${count === 1 ? " has" : "s have"} passed without a matching expense.`;
  }
  const count = assessment.evidenceExpenseIds.length;
  return `${count} recent expense${count === 1 ? " supports" : "s support"} this ${dimension} change.`;
}

function Comparison({ change, dimension, assessment }) {
  if (dimension === "missing") {
    return (
      <div className="commitment-change__missing">
        <strong>{assessment.state === "possibly_ended" ? "Possibly ended" : "Not seen recently"}</strong>
        <span>This is an observation, not an automatic status change.</span>
        <ul>
          {assessment.missedSlotAnchors.map((anchor) => <li key={anchor}>{formatDate(anchor)}</li>)}
        </ul>
      </div>
    );
  }

  const current = dimension === "amount"
    ? amountSummary(change.commitment)
    : timingSummary(change.commitment);
  const proposed = dimension === "amount"
    ? proposedAmountSummary(assessment)
    : proposedTimingSummary(change.commitment, assessment);
  return (
    <dl className="commitment-change__comparison">
      <div><dt>Current expectation</dt><dd>{current}</dd></div>
      <div><dt>Observed change</dt><dd>{proposed}</dd></div>
    </dl>
  );
}

function ChangeActions({ change, dimension, assessment, state, kept, activeTask, onTaskChange, onReviewedOpenChange }) {
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
        (focusId === "kept-changes-heading" ? target?.closest("summary") : target)?.focus();
      }
    });
  }

  if (kept) {
    return (
      <div className="inline-actions commitment-change__actions">
        <button
          type="button"
          disabled={actionDisabled}
          aria-label={`Reconsider ${dimension} change for ${name}`}
          onClick={() => run(
            () => state.reconsiderChange(change.commitment.id, dimension, assessment.fingerprint),
            "changes-review-heading"
          )}
        >
          {state.busyKey ? "Updating..." : "Reconsider"}
        </button>
      </div>
    );
  }

  if (dimension === "missing" && confirmingEnd) {
    const confirmationId = `end-confirmation-${change.commitment.id}`;
    return (
      <div className="commitment-change__confirmation" role="group" aria-labelledby={confirmationId}>
        <p id={confirmationId}>
          Mark {name} ended? This changes its status, and you can change it again from the confirmed commitment.
        </p>
        <div className="inline-actions">
          <button
            ref={confirmEndRef}
            type="button"
            className="button-danger"
            disabled={confirmationDisabled}
            aria-label={`Confirm mark ${name} ended`}
            onClick={() => run(
              () => state.markEndedFromChange(change.commitment.id, assessment.fingerprint),
              "changes-review-heading"
            )}
          >
            {state.busyKey ? "Marking ended..." : "Confirm mark ended"}
          </button>
          <button
            type="button"
            className="button-ghost"
            disabled={cancelDisabled}
            aria-label={`Cancel marking ${name} ended`}
            onClick={() => {
              restoreEndFocus.current = true;
              onTaskChange(null);
            }}
          >
            Cancel
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
          aria-label={`Accept amount change for ${name}`}
          onClick={() => run(
            () => state.acceptAmountChange(change.commitment.id, assessment.fingerprint),
            "changes-review-heading"
          )}
        >
          {state.busyKey ? "Updating..." : "Accept change"}
        </button>
      )}
      {dimension === "timing" && (
        <button
          type="button"
          disabled={actionDisabled}
          aria-label={`Accept timing change for ${name}`}
          onClick={() => run(
            () => state.acceptTimingChange(change.commitment.id, assessment.fingerprint),
            "changes-review-heading"
          )}
        >
          {state.busyKey ? "Updating..." : "Accept change"}
        </button>
      )}
      <button
        type="button"
        className="button-ghost"
        disabled={actionDisabled}
        aria-label={dimension === "missing"
          ? `Keep active for ${name}`
          : `Keep current ${dimension} for ${name}`}
        onClick={() => run(
          () => state.keepChange(change.commitment.id, dimension, assessment.fingerprint),
          "kept-changes-heading",
          true
        )}
      >
        {state.busyKey ? "Updating..." : dimension === "missing" ? "Keep active" : "Keep current"}
      </button>
      {dimension === "missing" && assessment.state === "possibly_ended" && (
        <button
          ref={endTriggerRef}
          type="button"
          className="button-danger"
          disabled={actionDisabled}
          aria-label={`Mark ${name} ended`}
          onClick={() => onTaskChange({ mode: "change-end", key: taskKey })}
        >
          Mark ended
        </button>
      )}
    </div>
  );
}

function ChangeCard({ change, state, kept, activeTask, onTaskChange, onReviewedOpenChange }) {
  return (
    <Card as="article" className={`commitment-card commitment-change-card${kept ? " commitment-change-card--kept" : ""}`}>
      <div className="commitment-card__header">
        <div>
          <p className="commitment-card__eyebrow">{kept ? "Reviewed change" : "Needs your decision"}</p>
          <h3>{change.commitment.name}</h3>
          <p className="muted">{displayText(change.commitment.category)} · {title(change.commitment.cadence)}</p>
        </div>
      </div>

      <div className="commitment-change__panels">
        {change.assessments.map(({ dimension, assessment }) => {
          const evidence = evidenceFor(change, assessment);
          const exactAmountAvailable = dimension !== "amount"
            || exactAmountAssessmentAvailable(change, assessment);
          return (
            <section className="commitment-change__panel" key={`${dimension}:${assessment.fingerprint}`}>
              <div className="commitment-change__panel-header">
                <div>
                  <p className="commitment-change__dimension">{title(dimension)} review</p>
                  <h4>{explanation(change, dimension, assessment)}</h4>
                </div>
                <span className={`commitment-change__status commitment-change__status--${kept ? "kept" : "pending"}`}>
                  {kept ? "Kept" : "Pending"}
                </span>
              </div>
              <Comparison change={change} dimension={dimension} assessment={assessment} />
              {!exactAmountAvailable && <p className="muted">Exact amount review is unavailable. Refresh with an updated client before making this amount decision.</p>}
              <details className="commitment-change__details">
                <summary aria-label={`Details for ${dimension} change for ${change.commitment.name}`}>Details</summary>
                {evidence.length > 0 && <CommitmentEvidence evidence={evidence} />}
                <dl className="commitment-change__mechanics">
                  <div><dt>Evaluated</dt><dd>{formatDate(state.changeEvaluatedOn)}</dd></div>
                  <div><dt>Detection details</dt><dd>{change.algorithmVersion}</dd></div>
                </dl>
              </details>
              <ChangeActions change={change} dimension={dimension} assessment={assessment} state={state} kept={kept}
                activeTask={activeTask} onTaskChange={onTaskChange} onReviewedOpenChange={onReviewedOpenChange} />
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function changeCount(changes) {
  return changes.reduce((count, change) => count + change.assessments.length, 0);
}

function ChangeList({ changes, state, kept = false, activeTask, onTaskChange, onReviewedOpenChange }) {
  if (changes.length === 0) return <p className="empty-state">{kept ? "No reviewed changes." : "No commitment changes need your review."}</p>;
  return (
    <div className="commitment-list">
      {changes.map((change) => (
        <ChangeCard key={change.commitment.id} change={change} state={state} kept={kept}
          activeTask={activeTask} onTaskChange={onTaskChange} onReviewedOpenChange={onReviewedOpenChange} />
      ))}
    </div>
  );
}

function PendingChanges({ changes, state, activeTask, onTaskChange, onReviewedOpenChange }) {
  return (
    <section className="commitment-section" aria-labelledby="changes-review-heading">
      <div className="commitment-section__header">
        <div>
          <h2 id="changes-review-heading" tabIndex="-1">Changes to review</h2>
          <p className="muted">Review the latest evidence before changing an expectation or commitment status. Each decision applies only to this exact assessment.</p>
        </div>
        <span className="commitment-count">{changeCount(changes)}</span>
      </div>
      <ChangeList changes={changes} state={state} activeTask={activeTask}
        onTaskChange={onTaskChange} onReviewedOpenChange={onReviewedOpenChange} />
    </section>
  );
}

function ReviewedChanges({ changes, state, activeTask, onTaskChange, open, onOpenChange, onReviewedOpenChange }) {
  const locked = Boolean(state.busyKey?.includes(":reconsider:"));
  return (
    <details className="commitment-section commitment-change-history" open={open || locked}
      onToggle={(event) => { if (!locked) onOpenChange(event.currentTarget.open); }}>
      <summary aria-disabled={locked || undefined} onClick={(event) => { if (locked) event.preventDefault(); }}>
        <h2 id="kept-changes-heading">Reviewed changes <span>({changeCount(changes)})</span></h2>
      </summary>
      <div className="commitment-change-history__content">
        <p className="muted">These exact observations were kept without changing the saved expectation. Reconsider one if you want to review it again.</p>
        {locked && <p className="muted">Finish reconsidering this change before closing reviewed history.</p>}
        <ChangeList changes={changes} state={state} kept activeTask={activeTask}
          onTaskChange={onTaskChange} onReviewedOpenChange={onReviewedOpenChange} />
      </div>
    </details>
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
