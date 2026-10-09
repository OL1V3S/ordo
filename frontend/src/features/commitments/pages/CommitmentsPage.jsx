import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ListRow from "../../../shared/ui/ListRow";
import RowActionsMenu from "../../../shared/ui/RowActionsMenu";
import SectionHeader from "../../../shared/ui/SectionHeader";
import StatusMessage from "../../../shared/ui/StatusMessage";
import CommitmentEvidence from "../components/CommitmentEvidence";
import CommitmentChangeReview from "../components/CommitmentChangeReview";
import CommitmentForm from "../components/CommitmentForm";
import HistoryDisclosure from "../components/HistoryDisclosure";
import { useCommitments } from "../hooks/useCommitments";
import { cadenceLabel, evidenceRuleLabel, formatDate, formatDerivedMoney, formatMoney, lifecycleLabel, weekdayLabel } from "../utils/formatCommitments";
import groupCommitmentChanges from "../utils/groupCommitmentChanges";
import { displayText } from "../../../utils/text";
import { useLocation } from "react-router-dom";
import "../../../styles/commitments.css";

function timingSummary(model, t) {
  const window = {
    before: t("timing.summary.before", { count: Number(model.windowBeforeDays) }),
    after: t("timing.summary.after", { count: Number(model.windowAfterDays) }),
  };
  if (model.cadence === "weekly") return t("timing.summary.weekly", { weekday: weekdayLabel(model.expectedDayOfWeek, t), ...window });
  if (model.cadence === "monthly" && model.timingKind === "monthend") return t("timing.summary.monthEnd", window);
  if (model.cadence === "yearly") return t("timing.summary.yearly", { month: model.expectedMonth, day: model.expectedDay, ...window });
  return t("timing.summary.dayOfMonth", { day: model.expectedDay, ...window });
}

function amountSummary(model) {
  if (model.amountMode) {
    if (model.amountMode === "fixed") return formatMoney(model.expectedAmount);
    return `${formatMoney(model.expectedMinimumAmount)}–${formatMoney(model.expectedMaximumAmount)}`;
  }
  if (model.observedAmountMode === "fixed") return formatDerivedMoney(model.observedMedianAmount);
  return `${formatDerivedMoney(model.observedMinimumAmount)}–${formatDerivedMoney(model.observedMaximumAmount)}`;
}

function CandidateRow({ candidate, dismissed, state, task, disabled, onOpen, onCancel, onDraftChange, onSubmit, onDecision }) {
  const { t } = useTranslation("commitments");
  const reviewing = task?.mode === "confirm" && task.key === candidate.fingerprint;
  const busy = Boolean(state.busyKey) || state.loading;
  const name = candidate.description;
  const review = (event) => onOpen({ mode: "confirm", key: candidate.fingerprint, model: candidate }, event.currentTarget);
  const actions = reviewing ? null : dismissed ? (
    <button type="button" disabled={disabled} aria-label={t("candidates.reconsiderLabel", { name })} onClick={() => onDecision(candidate.fingerprint, true)}>{t("candidates.reconsider")}</button>
  ) : <>
    <button type="button" disabled={disabled} aria-label={t("candidates.reviewAndConfirmLabel", { name })} onClick={review}>{t("candidates.reviewAndConfirm")}</button>
    <RowActionsMenu triggerLabel={t("actions.menuLabel", { name })} items={[
      { key: "dismiss", label: t("candidates.dismissLabel", { name }), text: t("candidates.dismiss"), className: "button-ghost", disabled, onSelect: () => onDecision(candidate.fingerprint, false) },
    ]} />
  </>;
  return (
    <ListRow className={`commitment-row${dismissed ? " commitment-row--dismissed" : ""}`} titleAs="h3" label={dismissed ? t("candidates.dismissedStatus") : null} title={name}
      meta={<>
        <span>{displayText(candidate.category)} · {cadenceLabel(candidate.cadence, t)}</span>
        <span>{t(candidate.observedAmountMode === "fixed" ? "candidates.basedOnFixed" : "candidates.basedOnRange", { count: candidate.occurrenceCount })}</span>
      </>}
      amount={<><span className="commitment-row__caption">{candidate.observedAmountMode === "fixed" ? t("candidates.observedAmount") : t("candidates.observedAmountRange")}</span><strong className="commitment-row__amount">{amountSummary(candidate)}</strong></>}
      actions={actions}>
      <details className="commitment-details">
        <summary aria-label={t("saved.detailsLabel", { name })}>{t("saved.details")}</summary>
        <dl className="commitment-facts">
          <div><dt>{t("candidates.evidence")}</dt><dd>{t("candidates.evidenceSummary", { count: candidate.occurrenceCount, rule: evidenceRuleLabel(candidate.evidenceRule, t) })}</dd></div>
          <div><dt>{t("candidates.coveredPeriod")}</dt><dd>{formatDate(candidate.coveredFrom, t)}–{formatDate(candidate.coveredTo, t)}</dd></div>
          <div><dt>{t("candidates.observedTiming")}</dt><dd>{timingSummary(candidate, t)}</dd></div>
          <div><dt>{t("candidates.observedAmount")}</dt><dd>{candidate.observedAmountMode === "fixed" ? t("candidates.identical") : t("candidates.median", { amount: formatDerivedMoney(candidate.observedMedianAmount) })}</dd></div>
          <div><dt>{t("candidates.detectionDetails")}</dt><dd>{candidate.algorithmVersion}</dd></div>
        </dl>
        <CommitmentEvidence evidence={candidate.evidence} />
      </details>
      {reviewing && <CommitmentForm model={task.model} fingerprint={candidate.fingerprint} submitLabel={t("candidates.confirmCommitment")} busy={busy} submitDisabled={Boolean(state.loadError)} initialDraft={task.draft} onDraftChange={onDraftChange} onSubmit={(payload) => onSubmit(() => state.confirmCandidate(payload))} onCancel={onCancel} />}
    </ListRow>
  );
}

function ConfirmedCommitmentRow({ commitment, state, task, disabled, onOpen, onCancel, onDraftChange, onSubmit, onLifecycle }) {
  const { t } = useTranslation("commitments");
  const confirmRef = useRef(null);
  const editing = task?.mode === "edit" && task.key === commitment.id;
  const ending = task?.mode === "end" && task.key === commitment.id && task.lifecycle === commitment.lifecycle;
  const busy = Boolean(state.busyKey) || state.loading;
  const name = commitment.name;
  useEffect(() => { if (ending) confirmRef.current?.focus(); }, [ending]);

  const edit = { key: "edit", label: t("saved.editLabel", { name }), text: t("saved.edit"), className: "button-ghost", disabled, onSelect: (trigger) => onOpen({ mode: "edit", key: commitment.id, model: commitment }, trigger) };
  const pause = { key: "pause", label: t("saved.pauseLabel", { name }), text: t("saved.pause"), className: "button-ghost", disabled, onSelect: () => onLifecycle(commitment.id, "paused") };
  const end = { key: "end", label: t("saved.endLabel", { name }), text: t("saved.end"), className: "button-ghost", disabled, onSelect: (trigger) => onOpen({ mode: "end", key: commitment.id, lifecycle: commitment.lifecycle }, trigger) };
  const items = commitment.lifecycle === "active" ? [edit, pause, end] : commitment.lifecycle === "paused" ? [edit, end] : [edit, pause];
  // Row actions stay unmounted during this record's own task, as the footer buttons did.
  const actions = editing || ending ? null : <>
    {commitment.lifecycle !== "active" && <button type="button" disabled={disabled} aria-label={t("saved.reactivateLabel", { name })} onClick={() => onLifecycle(commitment.id, "active")}>{t("saved.reactivate")}</button>}
    <RowActionsMenu triggerLabel={t("actions.menuLabel", { name })} items={items} />
  </>;

  return (
    <ListRow className={`commitment-row commitment-row--${commitment.lifecycle}`} titleAs="h3" label={lifecycleLabel(commitment.lifecycle, t)} title={name}
      meta={<>
        <span>{displayText(commitment.category)} · {cadenceLabel(commitment.cadence, t)}</span>
        <span>{timingSummary(commitment, t)}</span>
      </>}
      amount={<><span className="commitment-row__caption">{t("saved.expectedAmount")}</span><strong className="commitment-row__amount">{amountSummary(commitment)}</strong></>}
      actions={actions}>
      <details className="commitment-details">
        <summary aria-label={t("saved.detailsLabel", { name })}>{t("saved.details")}</summary>
        <dl className="commitment-facts">
          <div><dt>{t("saved.recordsUsed")}</dt><dd>{t("saved.linkedExpenses", { count: commitment.evidence.length })}</dd></div>
        </dl>
        <CommitmentEvidence evidence={commitment.evidence} heading={t("saved.recordsUsed")} />
      </details>
      {editing ? (
        <CommitmentForm model={task.model} submitLabel={t("saved.saveChanges")} busy={busy} submitDisabled={Boolean(state.loadError)} initialDraft={task.draft} onDraftChange={onDraftChange} onSubmit={(payload) => onSubmit(() => state.updateCommitment(commitment.id, payload))} onCancel={onCancel} />
      ) : ending && (
        <div className="commitment-change__confirmation" role="group" aria-label={t("saved.endLabel", { name })}>
          <p>{t("saved.endPrompt", { name })}</p>
          <div className="inline-actions">
            <button ref={confirmRef} type="button" disabled={busy || Boolean(state.loadError)} onClick={() => onLifecycle(commitment.id, "ended")}>{t("saved.confirmEnd")}</button>
            <button type="button" className="button-ghost" disabled={busy} onClick={onCancel}>{t("saved.cancelEnd")}</button>
          </div>
        </div>
      )}
    </ListRow>
  );
}

export default function CommitmentsPage() {
  const { t } = useTranslation("commitments");
  const location = useLocation();
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
    if (location.hash === "#changes-review-heading" && hasLoaded)
      focusDestination("changes-review-heading", false);
  }, [location.hash, hasLoaded]);

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
      const target = preferError && feedback?.querySelector('[role="alert"]') ? feedback : destination?.querySelector(":scope > .ui-disclosure__button") ?? destination;
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

  function savedRow(commitment) {
    return <ConfirmedCommitmentRow key={commitment.id} commitment={commitment} state={state} task={activeTask} disabled={disabled} onOpen={openTask} onCancel={cancelTask} onDraftChange={saveDraft} onSubmit={submit} onLifecycle={lifecycle} />;
  }

  function candidateRow(candidate, dismissed = false) {
    return <CandidateRow key={candidate.fingerprint} candidate={candidate} dismissed={dismissed} state={state} task={activeTask} disabled={disabled} onOpen={openTask} onCancel={cancelTask} onDraftChange={saveDraft} onSubmit={submit} onDecision={decide} />;
  }

  const active = state.commitments.filter((commitment) => commitment.lifecycle === "active");
  const reviewProps = { state, activeTask, onTaskChange: setActiveTask, reviewedOpen, onReviewedOpenChange: setReviewedOpen };
  const dismissedBusy = Boolean(state.busyKey?.startsWith("reconsider:"));

  return (
    <div className="container commitments-page">
      <header className="page-header"><div><h1>{t("page.title")}</h1><p className="muted">{t("page.subtitle")}</p></div></header>
      <div id="commitments-feedback" className="commitment-feedback" tabIndex={-1}>
        {state.loadError && <StatusMessage tone="danger">{state.loadError}</StatusMessage>}
        {state.loadError && hasLoaded && <p className="muted">{t("feedback.outOfDate")}</p>}
        {state.actionError && <StatusMessage tone="danger">{state.actionError}</StatusMessage>}
        {state.notice && <StatusMessage tone="success">{state.notice}</StatusMessage>}
        {state.loading && <StatusMessage>{hasLoaded ? t("feedback.refreshing") : t("feedback.loading")}</StatusMessage>}
        {state.busyKey && <StatusMessage>{t("feedback.saving")}</StatusMessage>}
        {(state.loadError || state.actionError) && <div className="commitment-feedback__actions"><button type="button" disabled={busy} onClick={() => state.refresh()}>{hasLoaded ? t("feedback.refresh") : t("feedback.tryAgain")}</button></div>}
      </div>
      {showContent && <>
        {(pendingCount > 0 || state.candidates.length > 0) && <nav className="commitment-review-links" aria-label={t("page.reviewLinks")}>
          {pendingCount > 0 && <a href="#changes-review-heading" onClick={() => focusDestination("changes-review-heading", false)}>{t("page.changesLink", { count: pendingCount })}</a>}
          {state.candidates.length > 0 && <a href="#candidate-heading" onClick={() => focusDestination("candidate-heading", false)}>{t("page.possibleLink", { count: state.candidates.length })}</a>}
        </nav>}
        <section className="commitment-section" aria-labelledby="confirmed-heading">
          <SectionHeader id="confirmed-heading" focusable title={t("saved.heading")} />
          {active.length > 0 ? <div role="group" aria-label={t("saved.activeGroup")}><ul className="commitment-rows">{active.map(savedRow)}</ul></div> : <p className="empty-state">{state.commitments.length === 0 ? t("saved.emptyNone") : t("saved.emptyNoActive")}</p>}
        </section>
        <CommitmentChangeReview {...reviewProps} view="pending" />
        <section className="commitment-section" aria-labelledby="candidate-heading">
          <SectionHeader id="candidate-heading" focusable title={t("candidates.heading")} action={state.candidates.length > 0 ? <span className="commitment-count">{t("candidates.toReview", { count: state.candidates.length })}</span> : null} />
          <p className="muted">{t("candidates.intro")}</p>
          {state.candidates.length === 0 ? <p className="empty-state">{t("candidates.empty")}</p> : <ul className="commitment-rows">{state.candidates.map((candidate) => candidateRow(candidate))}</ul>}
        </section>
        {["paused", "ended"].map((kind) => {
          const commitments = state.commitments.filter((commitment) => commitment.lifecycle === kind);
          const locked = commitments.some((commitment) => ((activeTask?.mode === "edit" || activeTask?.mode === "end") && activeTask.key === commitment.id) || state.busyKey === `lifecycle:${commitment.id}`);
          return commitments.length > 0 && <HistoryDisclosure key={kind} headingId={`commitments-${kind}-heading`} panelId={`commitments-${kind}-panel`} lockNoteId={`commitments-${kind}-lock-note`}
            title={t(`history.${kind}`)} count={commitments.length} open={historyOpen[kind] || locked} locked={locked} onToggle={() => setHistory(kind, !historyOpen[kind])}>
            <div role="group" aria-label={t(`history.${kind}`)} className="commitment-history__group">
              {locked && <p id={`commitments-${kind}-lock-note`} className="muted">{t("history.locked")}</p>}
              <ul className="commitment-rows">{commitments.map(savedRow)}</ul>
            </div>
          </HistoryDisclosure>;
        })}
        <CommitmentChangeReview {...reviewProps} view="reviewed" />
        <HistoryDisclosure headingId="dismissed-heading" panelId="commitments-dismissed-panel" lockNoteId="commitments-dismissed-lock-note"
          title={t("history.dismissedHeading")} count={state.dismissedCandidates.length} open={historyOpen.dismissed || dismissedBusy} locked={dismissedBusy} onToggle={() => setHistory("dismissed", !historyOpen.dismissed)}>
          {dismissedBusy && <p id="commitments-dismissed-lock-note" className="muted">{t("history.dismissedLocked")}</p>}
          <p className="muted">{t("history.dismissedIntro")}</p>
          {state.dismissedCandidates.length === 0 ? <p className="empty-state">{t("history.dismissedEmpty")}</p> : <ul className="commitment-rows">{state.dismissedCandidates.map((candidate) => candidateRow(candidate, true))}</ul>}
        </HistoryDisclosure>
      </>}
    </div>
  );
}
