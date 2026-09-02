import { useEffect, useRef, useState } from "react";
import Card from "../../../shared/ui/Card";
import CommitmentEvidence from "./CommitmentEvidence";
import { formatDate, formatMoney } from "../utils/formatCommitments";
import groupCommitmentChanges from "../utils/groupCommitmentChanges";

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
  if (assessment.proposedMode === "fixed") return formatMoney(assessment.proposedAmount);
  return `${formatMoney(assessment.proposedMinimumAmount)}–${formatMoney(assessment.proposedMaximumAmount)}`;
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
      <div><dt>Observed proposal</dt><dd>{proposed}</dd></div>
    </dl>
  );
}

function ChangeActions({ change, dimension, assessment, state, kept }) {
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const endTriggerRef = useRef(null);
  const confirmEndRef = useRef(null);
  const restoreEndFocus = useRef(false);
  const disabled = Boolean(state.busyKey);
  const name = change.commitment.name;

  useEffect(() => {
    if (confirmingEnd) {
      confirmEndRef.current?.focus();
    } else if (restoreEndFocus.current) {
      restoreEndFocus.current = false;
      endTriggerRef.current?.focus();
    }
  }, [confirmingEnd]);

  async function run(operation, focusId) {
    await operation();
    document.getElementById(focusId)?.focus();
  }

  if (kept) {
    return (
      <div className="inline-actions commitment-change__actions">
        <button
          type="button"
          disabled={disabled}
          aria-label={`Reconsider ${dimension} change for ${name}`}
          onClick={() => run(
            () => state.reconsiderChange(change.commitment.id, dimension, assessment.fingerprint),
            "changes-review-heading"
          )}
        >
          {disabled ? "Updating..." : "Reconsider"}
        </button>
      </div>
    );
  }

  if (dimension === "missing" && confirmingEnd) {
    const confirmationId = `end-confirmation-${change.commitment.id}`;
    return (
      <div className="commitment-change__confirmation" role="group" aria-labelledby={confirmationId}>
        <p id={confirmationId}>
          Mark {name} ended? This changes its lifecycle, and you can change it again from the confirmed commitment.
        </p>
        <div className="inline-actions">
          <button
            ref={confirmEndRef}
            type="button"
            className="button-danger"
            disabled={disabled}
            aria-label={`Confirm mark ${name} ended`}
            onClick={() => run(
              () => state.markEndedFromChange(change.commitment.id, assessment.fingerprint),
              "changes-review-heading"
            )}
          >
            {disabled ? "Marking ended..." : "Confirm mark ended"}
          </button>
          <button
            type="button"
            className="button-ghost"
            disabled={disabled}
            aria-label={`Cancel marking ${name} ended`}
            onClick={() => {
              restoreEndFocus.current = true;
              setConfirmingEnd(false);
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
          disabled={disabled}
          aria-label={`Accept amount change for ${name}`}
          onClick={() => run(
            () => state.acceptAmountChange(change.commitment.id, assessment.fingerprint),
            "changes-review-heading"
          )}
        >
          {disabled ? "Updating..." : "Accept change"}
        </button>
      )}
      {dimension === "timing" && (
        <button
          type="button"
          disabled={disabled}
          aria-label={`Accept timing change for ${name}`}
          onClick={() => run(
            () => state.acceptTimingChange(change.commitment.id, assessment.fingerprint),
            "changes-review-heading"
          )}
        >
          {disabled ? "Updating..." : "Accept change"}
        </button>
      )}
      <button
        type="button"
        className="button-ghost"
        disabled={disabled}
        aria-label={dimension === "missing"
          ? `Keep active for ${name}`
          : `Keep current ${dimension} for ${name}`}
        onClick={() => run(
          () => state.keepChange(change.commitment.id, dimension, assessment.fingerprint),
          "kept-changes-heading"
        )}
      >
        {disabled ? "Updating..." : dimension === "missing" ? "Keep active" : "Keep current"}
      </button>
      {dimension === "missing" && assessment.state === "possibly_ended" && (
        <button
          ref={endTriggerRef}
          type="button"
          className="button-danger"
          disabled={disabled}
          aria-label={`Mark ${name} ended`}
          onClick={() => setConfirmingEnd(true)}
        >
          Mark ended
        </button>
      )}
    </div>
  );
}

function ChangeCard({ change, state, kept }) {
  return (
    <Card as="article" className={`commitment-card commitment-change-card${kept ? " commitment-change-card--kept" : ""}`}>
      <div className="commitment-card__header">
        <div>
          <p className="commitment-card__eyebrow">{kept ? "Kept change" : "Needs your decision"}</p>
          <h3>{change.commitment.name}</h3>
          <p className="muted">{change.commitment.category} · {title(change.commitment.cadence)}</p>
        </div>
        <span className="commitment-change__evaluated">Evaluated {formatDate(state.changeEvaluatedOn)}</span>
      </div>

      <div className="commitment-change__panels">
        {change.assessments.map(({ dimension, assessment }) => {
          const evidence = evidenceFor(change, assessment);
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
              {evidence.length > 0 && <CommitmentEvidence evidence={evidence} />}
              <p className="muted commitment-change__rule">Rule version {change.algorithmVersion}</p>
              <ChangeActions change={change} dimension={dimension} assessment={assessment} state={state} kept={kept} />
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function ChangeSection({ id, title: sectionTitle, description, changes, state, kept = false }) {
  return (
    <section className="commitment-section" aria-labelledby={id}>
      <div className="commitment-section__header">
        <div>
          <h2 id={id} tabIndex="-1">{sectionTitle}</h2>
          <p className="muted">{description}</p>
        </div>
        <span className="commitment-count">{changes.reduce((count, change) => count + change.assessments.length, 0)}</span>
      </div>
      {changes.length === 0 ? (
        <p className="empty-state">{kept ? "No kept changes." : "No commitment changes need your review."}</p>
      ) : (
        <div className="commitment-list">
          {changes.map((change) => (
            <ChangeCard key={change.commitment.id} change={change} state={state} kept={kept} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function CommitmentChangeReview({ state }) {
  const pending = groupCommitmentChanges(state.commitmentChanges, "pending");
  const kept = groupCommitmentChanges(state.commitmentChanges, "kept");

  return (
    <>
      <ChangeSection
        id="changes-review-heading"
        title="Changes to review"
        description="Review the latest evidence before changing an expectation or commitment status. Each decision applies only to this exact assessment."
        changes={pending}
        state={state}
      />
      <ChangeSection
        id="kept-changes-heading"
        title="Kept changes"
        description="These exact observations were kept without changing the saved expectation. Reconsider one if you want to review it again."
        changes={kept}
        state={state}
        kept
      />
    </>
  );
}
