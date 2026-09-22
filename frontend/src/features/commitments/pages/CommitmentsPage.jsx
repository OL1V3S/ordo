import { useEffect, useRef, useState } from "react";
import Card from "../../../shared/ui/Card";
import StatusMessage from "../../../shared/ui/StatusMessage";
import CommitmentEvidence from "../components/CommitmentEvidence";
import CommitmentChangeReview from "../components/CommitmentChangeReview";
import CommitmentForm from "../components/CommitmentForm";
import { useCommitments } from "../hooks/useCommitments";
import { formatDate, formatDerivedMoney, formatMoney } from "../utils/formatCommitments";
import groupCommitmentChanges from "../utils/groupCommitmentChanges";
import { displayText } from "../../../utils/text";

const EVIDENCE_RULES = {
  consecutive_calendar_months: "Consecutive calendar months",
  weekly_six_to_eight_day_gaps: "Weekly, with 6–8 days between expenses",
  consecutive_years_same_month: "Consecutive years in the same month",
};

function words(value) {
  return value?.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2") ?? "";
}

function title(value) {
  const text = words(value);
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function timingSummary(model) {
  if (model.cadence === "weekly") return `${title(model.expectedDayOfWeek)} with a ${model.windowBeforeDays}-day before / ${model.windowAfterDays}-day after window`;
  if (model.cadence === "monthly" && model.timingKind === "monthend") return `Month end, with a ${model.windowBeforeDays}-day before / ${model.windowAfterDays}-day after window`;
  if (model.cadence === "yearly") return `Month ${model.expectedMonth}, day ${model.expectedDay}, with a ${model.windowBeforeDays}-day before / ${model.windowAfterDays}-day after window`;
  return `Day ${model.expectedDay}, with a ${model.windowBeforeDays}-day before / ${model.windowAfterDays}-day after window`;
}

function amountSummary(model) {
  if (model.amountMode) {
    if (model.amountMode === "fixed") return formatMoney(model.expectedAmount);
    return `${formatMoney(model.expectedMinimumAmount)}–${formatMoney(model.expectedMaximumAmount)}`;
  }
  if (model.observedAmountMode === "fixed") return formatDerivedMoney(model.observedMedianAmount);
  return `${formatDerivedMoney(model.observedMinimumAmount)}–${formatDerivedMoney(model.observedMaximumAmount)}`;
}

function CandidateCard({ candidate, dismissed, state, task, disabled, onOpen, onCancel, onDraftChange, onSubmit, onDecision }) {
  const reviewing = task?.mode === "confirm" && task.key === candidate.fingerprint;
  const busy = Boolean(state.busyKey) || state.loading;
  return (
    <Card as="article" className="commitment-card">
      <div className="commitment-card__header">
        <div>
          {dismissed && <p className="commitment-status">Dismissed possible commitment</p>}
          <h3>{candidate.description}</h3>
          <p className="muted">{displayText(candidate.category)} · {title(candidate.cadence)}</p>
        </div>
        <div className="commitment-card__value"><span>Observed amount{candidate.observedAmountMode === "fixed" ? "" : " range"}</span><strong className="commitment-card__amount">{amountSummary(candidate)}</strong></div>
      </div>
      <p className="commitment-support">Based on {candidate.occurrenceCount} expenses{candidate.observedAmountMode !== "fixed" && ". Observed history, not a saved expectation."}</p>
      <details className="commitment-details">
        <summary aria-label={`Details for ${candidate.description}`}>Details</summary>
        <dl className="commitment-facts">
          <div><dt>Evidence</dt><dd>{candidate.occurrenceCount} expenses · {EVIDENCE_RULES[candidate.evidenceRule] ?? title(candidate.evidenceRule)}</dd></div>
          <div><dt>Covered period</dt><dd>{formatDate(candidate.coveredFrom)}–{formatDate(candidate.coveredTo)}</dd></div>
          <div><dt>Observed timing</dt><dd>{timingSummary(candidate)}</dd></div>
          <div><dt>Observed amount</dt><dd>{candidate.observedAmountMode === "fixed" ? "Identical each time" : `Median ${formatDerivedMoney(candidate.observedMedianAmount)}`}</dd></div>
          <div><dt>Detection details</dt><dd>{candidate.algorithmVersion}</dd></div>
        </dl>
        <CommitmentEvidence evidence={candidate.evidence} />
      </details>
      {reviewing ? (
        <CommitmentForm model={task.model} fingerprint={candidate.fingerprint} submitLabel="Confirm commitment" busy={busy} submitDisabled={Boolean(state.loadError)} initialDraft={task.draft} onDraftChange={onDraftChange} onSubmit={(payload) => onSubmit(() => state.confirmCandidate(payload))} onCancel={onCancel} />
      ) : (
        <div className="inline-actions commitment-card__actions">
          {dismissed ? (
            <button type="button" disabled={disabled} aria-label={`Reconsider ${candidate.description}`} onClick={() => onDecision(candidate.fingerprint, true)}>Reconsider</button>
          ) : <>
            <button type="button" disabled={disabled} aria-label={`Review and confirm ${candidate.description}`} onClick={(event) => onOpen({ mode: "confirm", key: candidate.fingerprint, model: candidate }, event.currentTarget)}>Review and confirm</button>
            <button type="button" className="button-ghost" disabled={disabled} aria-label={`Dismiss ${candidate.description}`} onClick={() => onDecision(candidate.fingerprint, false)}>Dismiss</button>
          </>}
        </div>
      )}
    </Card>
  );
}

function ConfirmedCommitmentCard({ commitment, state, task, disabled, onOpen, onCancel, onDraftChange, onSubmit, onLifecycle }) {
  const detailsRef = useRef(null);
  const confirmRef = useRef(null);
  const editing = task?.mode === "edit" && task.key === commitment.id;
  const ending = task?.mode === "end" && task.key === commitment.id && task.lifecycle === commitment.lifecycle;
  const busy = Boolean(state.busyKey) || state.loading;
  useEffect(() => { if (ending) confirmRef.current?.focus(); }, [ending]);

  return (
    <Card as="article" className={`commitment-card commitment-card--${commitment.lifecycle}`}>
      <div className="commitment-card__header">
        <div>
          <p className="commitment-status">{title(commitment.lifecycle)}</p>
          <h3>{commitment.name}</h3>
          <p className="muted">{displayText(commitment.category)} · {title(commitment.cadence)}</p>
        </div>
        <div className="commitment-card__value"><span>Expected amount</span><strong className="commitment-card__amount">{amountSummary(commitment)}</strong></div>
      </div>
      <div className="commitment-timing"><span>Saved timing pattern</span><p>{timingSummary(commitment)}</p></div>
      <details ref={detailsRef} className="commitment-details">
        <summary aria-label={`Details for ${commitment.name}`}>Details</summary>
        <dl className="commitment-facts">
          <div><dt>Records used to confirm</dt><dd>{commitment.evidence.length} linked expense(s)</dd></div>
        </dl>
        <CommitmentEvidence evidence={commitment.evidence} heading="Records used to confirm" />
        {!editing && !ending && <div className="inline-actions commitment-card__actions">
          {commitment.lifecycle === "ended" ? (
            <button type="button" className="button-ghost" disabled={disabled} aria-label={`Pause ${commitment.name}`} onClick={() => onLifecycle(commitment.id, "paused")}>Pause</button>
          ) : (
            <button type="button" className="button-ghost" disabled={disabled} aria-label={`End ${commitment.name}`} onClick={(event) => onOpen({ mode: "end", key: commitment.id, lifecycle: commitment.lifecycle }, event.currentTarget)}>End</button>
          )}
        </div>}
      </details>
      {editing ? (
        <CommitmentForm model={task.model} submitLabel="Save changes" busy={busy} submitDisabled={Boolean(state.loadError)} initialDraft={task.draft} onDraftChange={onDraftChange} onSubmit={(payload) => onSubmit(() => state.updateCommitment(commitment.id, payload))} onCancel={onCancel} />
      ) : ending ? (
        <div className="commitment-change__confirmation" role="group" aria-label={`End ${commitment.name}`}>
          <p>End {commitment.name}? The saved expectation and linked records will remain. You can reactivate it.</p>
          <div className="inline-actions">
            <button ref={confirmRef} type="button" disabled={busy || Boolean(state.loadError)} onClick={() => onLifecycle(commitment.id, "ended")}>Confirm end</button>
            <button type="button" className="button-ghost" disabled={busy} onClick={() => { if (detailsRef.current) detailsRef.current.open = true; onCancel(); }}>Cancel ending</button>
          </div>
        </div>
      ) : (
        <div className="inline-actions commitment-card__actions">
          <button type="button" className="button-ghost" disabled={disabled} aria-label={`Edit ${commitment.name}`} onClick={(event) => onOpen({ mode: "edit", key: commitment.id, model: commitment }, event.currentTarget)}>Edit</button>
          {commitment.lifecycle === "active" ? (
            <button type="button" className="button-ghost" disabled={disabled} aria-label={`Pause ${commitment.name}`} onClick={() => onLifecycle(commitment.id, "paused")}>Pause</button>
          ) : (
            <button type="button" disabled={disabled} aria-label={`Reactivate ${commitment.name}`} onClick={() => onLifecycle(commitment.id, "active")}>Reactivate</button>
          )}
        </div>
      )}
    </Card>
  );
}

export default function CommitmentsPage() {
  const state = useCommitments();
  const [hasLoaded, setHasLoaded] = useState(false);
  const [activeTask, setActiveTask] = useState(null);
  const [historyOpen, setHistoryOpen] = useState({ paused: false, ended: false, dismissed: false });
  const [reviewedOpen, setReviewedOpen] = useState(false);
  const opener = useRef(null);
  const busy = Boolean(state.busyKey) || state.loading;
  const disabled = busy || Boolean(state.loadError) || Boolean(activeTask);
  const showContent = hasLoaded || (!state.loading && !state.loadError);
  const pendingCount = groupCommitmentChanges(state.commitmentChanges, "pending").reduce((count, change) => count + change.assessments.length, 0);

  useEffect(() => {
    if (!state.loading && !state.loadError) setHasLoaded(true);
  }, [state.loading, state.loadError]);

  useEffect(() => {
    if (!activeTask || activeTask.mode === "change-end") return;
    const present = activeTask.mode === "confirm"
      ? state.candidates.some((candidate) => candidate.fingerprint === activeTask.key)
      : state.commitments.some((commitment) => commitment.id === activeTask.key && (activeTask.mode !== "end" || commitment.lifecycle === activeTask.lifecycle));
    if (!present) setActiveTask(null);
  }, [activeTask, state.candidates, state.commitments]);

  function focusDestination(id, preferError = true) {
    const previousFocus = document.activeElement;
    requestAnimationFrame(() => {
      if (document.activeElement !== previousFocus && document.activeElement !== document.body) return;
      const feedback = document.getElementById("commitments-feedback");
      const destination = document.getElementById(id);
      const target = preferError && feedback?.querySelector('[role="alert"]') ? feedback : destination?.closest("summary") ?? destination;
      target?.focus();
    });
  }

  function openTask(task, trigger) {
    opener.current = { node: trigger, label: trigger.getAttribute("aria-label") };
    state.clearMessages();
    setActiveTask(task);
  }

  function cancelTask() {
    const previousFocus = document.activeElement;
    setActiveTask(null);
    requestAnimationFrame(() => {
      if (document.activeElement !== previousFocus && document.activeElement !== document.body) return;
      const { node, label } = opener.current ?? {};
      const target = node?.isConnected ? node : Array.from(document.querySelectorAll("button[aria-label]")).find((button) => button.getAttribute("aria-label") === label);
      (target?.disabled ? document.getElementById("commitments-feedback") : target ?? document.getElementById("confirmed-heading"))?.focus();
    });
  }

  function saveDraft(draft) {
    setActiveTask((current) => current ? { ...current, draft } : current);
  }

  async function submit(operation) {
    const result = await operation();
    if (result) setActiveTask(null);
    focusDestination(result ? "confirmed-heading" : "commitments-feedback");
  }

  async function lifecycle(id, value) {
    const result = await state.updateLifecycle(id, value);
    if (result) {
      setActiveTask(null);
      if (value !== "active") setHistoryOpen((current) => ({ ...current, [value]: true }));
    }
    // This heading stays mounted during combined refreshes; synchronous focus
    // cannot steal focus from a later End confirmation.
    document.getElementById(result ? "confirmed-heading" : "commitments-feedback")?.focus();
  }

  async function decide(fingerprint, reconsider) {
    await (reconsider ? state.reconsiderCandidate(fingerprint) : state.dismissCandidate(fingerprint));
    // These endpoints return 204. The hook owns success/error interpretation;
    // revealing a destination does not infer a successful financial decision.
    if (!reconsider) setHistoryOpen((current) => ({ ...current, dismissed: true }));
    focusDestination(reconsider ? "candidate-heading" : "dismissed-heading");
  }

  function setHistory(kind, open) {
    setHistoryOpen((current) => current[kind] === open ? current : { ...current, [kind]: open });
  }

  function savedCard(commitment) {
    return <ConfirmedCommitmentCard key={commitment.id} commitment={commitment} state={state} task={activeTask} disabled={disabled} onOpen={openTask} onCancel={cancelTask} onDraftChange={saveDraft} onSubmit={submit} onLifecycle={lifecycle} />;
  }

  function candidateCard(candidate, dismissed = false) {
    return <CandidateCard key={candidate.fingerprint} candidate={candidate} dismissed={dismissed} state={state} task={activeTask} disabled={disabled} onOpen={openTask} onCancel={cancelTask} onDraftChange={saveDraft} onSubmit={submit} onDecision={decide} />;
  }

  const active = state.commitments.filter((commitment) => commitment.lifecycle === "active");
  const reviewProps = { state, activeTask, onTaskChange: setActiveTask, reviewedOpen, onReviewedOpenChange: setReviewedOpen };
  const dismissedBusy = Boolean(state.busyKey?.startsWith("reconsider:"));

  return (
    <div className="container commitments-page">
      <header className="page-header"><div><h1>Commitments</h1><p className="muted">Manage saved expectations and review possible changes.</p></div></header>
      <div id="commitments-feedback" className="commitment-feedback" tabIndex={-1}>
        {state.loadError && <StatusMessage tone="danger">{state.loadError}</StatusMessage>}
        {state.loadError && hasLoaded && <p className="muted">Displayed information may be out of date. Refresh before making another decision.</p>}
        {state.actionError && <StatusMessage tone="danger">{state.actionError}</StatusMessage>}
        {state.notice && <StatusMessage tone="success">{state.notice}</StatusMessage>}
        {(state.loadError || state.actionError) && <button type="button" disabled={busy} onClick={() => state.refresh()}>{hasLoaded ? "Refresh commitments" : "Try again"}</button>}
        {state.loading && <StatusMessage>{hasLoaded ? "Refreshing commitments..." : "Loading commitments..."}</StatusMessage>}
        {state.busyKey && <StatusMessage>Saving your decision...</StatusMessage>}
      </div>
      {showContent && <>
        {(pendingCount > 0 || state.candidates.length > 0) && <nav className="commitment-review-links" aria-label="Commitment reviews">
          {pendingCount > 0 && <a href="#changes-review-heading" onClick={() => focusDestination("changes-review-heading", false)}>{pendingCount} change{pendingCount === 1 ? "" : "s"} to review</a>}
          {state.candidates.length > 0 && <a href="#candidate-heading" onClick={() => focusDestination("candidate-heading", false)}>{state.candidates.length} possible commitment{state.candidates.length === 1 ? "" : "s"}</a>}
        </nav>}
        <section className="commitment-section" aria-labelledby="confirmed-heading">
          <div className="commitment-section__header"><h2 id="confirmed-heading" tabIndex={-1}>Your commitments</h2></div>
          {active.length > 0 ? <div className="commitment-list" role="group" aria-label="Active commitments">{active.map(savedCard)}</div> : <p className="empty-state">{state.commitments.length === 0 ? "No commitments confirmed yet." : "No active commitments."}</p>}
        </section>
        <CommitmentChangeReview {...reviewProps} view="pending" />
        <section className="commitment-section" aria-labelledby="candidate-heading">
          <div className="commitment-section__header"><div><h2 id="candidate-heading" tabIndex={-1}>Possible commitments</h2><p className="muted">Review the expenses before confirming an expectation.</p></div>{state.candidates.length > 0 && <span className="commitment-count">{state.candidates.length} to review</span>}</div>
          {state.candidates.length === 0 ? <p className="empty-state">No possible commitments need your review.</p> : <div className="commitment-list">{state.candidates.map((candidate) => candidateCard(candidate))}</div>}
        </section>
        {["paused", "ended"].map((kind) => {
          const commitments = state.commitments.filter((commitment) => commitment.lifecycle === kind);
          const locked = commitments.some((commitment) => ((activeTask?.mode === "edit" || activeTask?.mode === "end") && activeTask.key === commitment.id) || state.busyKey === `lifecycle:${commitment.id}`);
          return commitments.length > 0 && <details key={kind} className="commitment-history" open={historyOpen[kind] || locked} onToggle={(event) => { if (!locked) setHistory(kind, event.currentTarget.open); }}>
            <summary aria-disabled={locked || undefined} onClick={(event) => { if (locked) event.preventDefault(); }}><h2>{title(kind)} commitments <span>({commitments.length})</span></h2></summary>
            <div className="commitment-history__content commitment-list" role="group" aria-label={`${title(kind)} commitments`}>
              {locked && <p className="muted">Finish or cancel the open action before closing this group.</p>}
              {commitments.map(savedCard)}
            </div>
          </details>;
        })}
        <CommitmentChangeReview {...reviewProps} view="reviewed" />
        <details className="commitment-history" open={historyOpen.dismissed || dismissedBusy} onToggle={(event) => { if (!dismissedBusy) setHistory("dismissed", event.currentTarget.open); }}>
          <summary aria-disabled={dismissedBusy || undefined} onClick={(event) => { if (dismissedBusy) event.preventDefault(); }}><h2 id="dismissed-heading">Dismissed possible commitments <span>({state.dismissedCandidates.length})</span></h2></summary>
          <div className="commitment-history__content">
            <p className="muted">Dismissals apply only to the exact evidence you reviewed. Reconsider one to review it again.</p>
            {state.dismissedCandidates.length === 0 ? <p className="empty-state">No dismissed possible commitments.</p> : <div className="commitment-list">{state.dismissedCandidates.map((candidate) => candidateCard(candidate, true))}</div>}
          </div>
        </details>
      </>}
    </div>
  );
}
