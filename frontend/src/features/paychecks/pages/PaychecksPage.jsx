import { useEffect, useRef, useState } from "react";
import { Plus, WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import Card from "../../../shared/ui/Card";
import StatusMessage from "../../../shared/ui/StatusMessage";
import PaycheckEvidence from "../components/PaycheckEvidence";
import PaycheckForm from "../components/PaycheckForm";
import { usePaychecks } from "../hooks/usePaychecks";
import { cadenceLabel, formatAmount, formatDate, formatMoney, formatSchedule, formatWindow } from "../utils/formatPaychecks";
import InflowForm from "../../inflows/components/InflowForm";
import { inflowsApi } from "../../inflows/api/inflowsApi";
import { initialInflowDraft, validateInflow } from "../../inflows/utils/inflowForm";
import { isCalendarDate, isUnsafeNumericAmount, parseAmount } from "../utils/paycheckForm";
import "../../../styles/inflows.css";

const LIFECYCLES = ["active", "paused", "ended"];
const STALE_CODES = new Set(["candidate_changed", "candidate_dismissed", "confirmation_conflict", "paycheck_not_found", "paycheck_not_active"]);

function receiptWarnings(profile, slot, inflow, t) {
  if (!slot || !inflow) return [];
  const warnings = [];
  if (isCalendarDate(inflow.date) && (inflow.date < slot.earliestExpectedDate || inflow.date > slot.latestExpectedDate))
    warnings.push(t("receipt.warnings.dateOutsideWindow"));
  const observed = isUnsafeNumericAmount(inflow.amount) ? null : parseAmount(inflow.amount);
  if (!observed) {
    if (inflow.amount !== "") warnings.push(t("receipt.warnings.amountNeedsReview"));
    return warnings;
  }
  if (profile.amount?.mode === "fixed") {
    const expected = isUnsafeNumericAmount(profile.amount.fixedAmount) ? null : parseAmount(profile.amount.fixedAmount);
    if (!expected) warnings.push(t("receipt.warnings.expectedAmountNeedsReview"));
    else if (observed.cents !== expected.cents) warnings.push(t("receipt.warnings.differsFromFixed"));
  } else {
    const minimum = isUnsafeNumericAmount(profile.amount?.minimumAmount) ? null : parseAmount(profile.amount?.minimumAmount);
    const maximum = isUnsafeNumericAmount(profile.amount?.maximumAmount) ? null : parseAmount(profile.amount?.maximumAmount);
    if (!minimum || !maximum) warnings.push(t("receipt.warnings.expectedRangeNeedsReview"));
    else if (observed.cents < minimum.cents || observed.cents > maximum.cents)
      warnings.push(t("receipt.warnings.outsideRange"));
  }
  return warnings;
}

// Validation failures from the shared cash-in helper map to `receipt.cashInErrors.*` codes by
// field; the panel resolves them to the selected language when it renders. A failed
// description is blank or longer than 500 characters; nothing else fails it.
function cashInErrorCodes(errors, draft) {
  return Object.fromEntries(Object.keys(errors).map((field) => [field, field === "description"
    ? (String(draft.description ?? "").trim() ? "descriptionTooLong" : "descriptionRequired")
    : field]));
}

function lifecycleLabel(lifecycle, t) {
  return LIFECYCLES.includes(lifecycle) ? t(`lifecycle.${lifecycle}`) : "";
}

function ReceiptPanel({ profile, busy, submitDisabled, onSubmit, onCancel }) {
  const { t } = useTranslation("paychecks");
  const fixed = profile.amount?.mode === "fixed" ? profile.amount.fixedAmount : null;
  const [selectedSlot, setSelectedSlot] = useState(() => profile.receiptSlots?.[0] ?? null);
  const [mode, setMode] = useState("new");
  const [draft, setDraft] = useState(() => ({
    ...initialInflowDraft(), description: profile.displayName,
    amount: fixed == null || isUnsafeNumericAmount(fixed) ? "" : parseAmount(fixed)?.value ?? "",
  }));
  const [errors, setErrors] = useState({});
  const [inflows, setInflows] = useState([]);
  const [inflowError, setInflowError] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (mode !== "existing" || inflows.length || inflowError) return;
    let active = true;
    inflowsApi.getAll().then((response) => { if (active) setInflows(Array.isArray(response.data) ? response.data : []); })
      .catch(() => { if (active) setInflowError(true); });
    return () => { active = false; };
  }, [mode, inflows.length, inflowError]);

  function submitNew() {
    const result = validateInflow(draft);
    setErrors(cashInErrorCodes(result.errors, draft));
    if (result.payload) onSubmit({ slotAnchor: selectedSlot.anchor, newInflow: result.payload });
  }

  const linked = new Set(profile.evidence.map((row) => row.accountInflowId));
  const choices = inflows.filter((row) => !linked.has(row.id)
    && row.description.toLowerCase().includes(search.trim().toLowerCase()));
  const availableSlots = profile.receiptSlots ?? [];
  const selectedSlotIsStale = selectedSlot && !availableSlots.some((slot) => slot.anchor === selectedSlot.anchor);
  const slotOptions = selectedSlotIsStale ? [selectedSlot, ...availableSlots] : availableSlots;
  const selectedInflow = mode === "new" ? draft : inflows.find((row) => String(row.id) === selectedId);
  const warnings = receiptWarnings(profile, selectedSlot, selectedInflow, t);

  return <section className="paycheck-receipt" aria-label={t("receipt.label", { name: profile.displayName })}>
    <h4>{t("receipt.heading")}</h4>
    <p className="muted">{t("receipt.intro")}</p>
    <label className="field">{t("receipt.slotLabel")}<select value={selectedSlot?.anchor ?? ""} onChange={(event) => setSelectedSlot(slotOptions.find((slot) => slot.anchor === event.target.value) ?? null)} disabled={busy}>
      {slotOptions.map((slot) => <option key={slot.anchor} value={slot.anchor}>{t(`receipt.slot.${slot.relation === "current" ? "current" : "previous"}${selectedSlotIsStale && slot.anchor === selectedSlot.anchor ? "Stale" : ""}`, { from: formatDate(slot.earliestExpectedDate, t), to: formatDate(slot.latestExpectedDate, t) })}</option>)}
    </select></label>
    <fieldset disabled={busy}><legend>{t("receipt.sourceLegend")}</legend>
      <label><input type="radio" name="receipt-source" checked={mode === "new"} onChange={() => setMode("new")} /> {t("receipt.sourceNew")}</label>
      <label><input type="radio" name="receipt-source" checked={mode === "existing"} onChange={() => setMode("existing")} /> {t("receipt.sourceExisting")}</label>
    </fieldset>
    {warnings.length > 0 && <div className="paycheck-receipt__warnings" aria-live="polite">
      {warnings.map((warning) => <p key={warning} className="inflow-form__warning">{warning}</p>)}
    </div>}
    {mode === "new" ? <InflowForm draft={draft} onChange={setDraft} pending={busy}
      fieldErrors={Object.fromEntries(Object.entries(errors).map(([field, code]) => [field, t(`receipt.cashInErrors.${code}`)]))}
      disabled={submitDisabled || !selectedSlot} amountNeedsReview={fixed != null && isUnsafeNumericAmount(fixed)} onSubmit={submitNew} onCancel={onCancel} /> : <div className="paycheck-receipt__existing">
      <label className="field">{t("receipt.search")}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {inflowError ? <StatusMessage tone="danger">{t("receipt.loadError")}</StatusMessage> : <fieldset disabled={busy}><legend>{t("receipt.chooseLegend")}</legend>
        {choices.map((row) => <label key={row.id}><input type="radio" name="existing-inflow" value={row.id} checked={selectedId === String(row.id)} onChange={(event) => setSelectedId(event.target.value)} /> {row.description} · {formatDate(row.date, t)} · {formatMoney(row.amount, t)}</label>)}
        {!choices.length && <p className="muted">{t("receipt.noMatches")}</p>}
      </fieldset>}
      <div className="inline-actions"><button type="button" disabled={busy || submitDisabled || !selectedSlot || !selectedId} onClick={() => onSubmit({ slotAnchor: selectedSlot.anchor, existingInflowId: Number(selectedId) })}>{t("receipt.link")}</button><button type="button" className="button-ghost" disabled={busy} onClick={onCancel}>{t("receipt.cancel")}</button></div>
    </div>}
  </section>;
}

function CandidateCard({ candidate, dismissed, evaluatedOn, busy, actionsDisabled, editor, onReview, onCancel, onConfirm, onDecision }) {
  const { t } = useTranslation("paychecks");
  const name = candidate.normalizedDescriptionIdentity;
  const reviewing = editor?.mode === "confirm" && editor.key === candidate.fingerprint;
  const observed = candidate.observedAmount;
  return (
    <Card as="article" className="paycheck-card">
      <header className="paycheck-card__header">
        <div>
          {dismissed && <p className="paycheck-status">{t("card.dismissedStatus")}</p>}
          <h3>{name}</h3>
          <p className="muted">{cadenceLabel(candidate.schedule.cadence, t)}</p>
        </div>
        <div className="paycheck-card__amount">
          <span>{t("card.observedDeposits")}</span>
          <strong>{observed.mode === "fixed" ? formatMoney(observed.fixedAmount, t) : `${formatMoney(observed.minimumAmount, t)}–${formatMoney(observed.maximumAmount, t)}`}</strong>
        </div>
      </header>
      <p className="paycheck-candidate-count">{t(observed.mode === "fixed" ? "card.basedOn" : "card.basedOnVariable", { total: candidate.occurrenceCount })}</p>
      <details className="paycheck-details">
        <summary aria-label={t("card.detailsLabel", { name })}>{t("card.details")}</summary>
        <dl className="paycheck-facts">
          <div><dt>{t("facts.schedule")}</dt><dd>{formatSchedule(candidate.schedule, t)}</dd></div>
          <div><dt>{t("facts.recordsCovered")}</dt><dd>{formatDate(candidate.coveredFrom, t)}–{formatDate(candidate.coveredTo, t)}</dd></div>
          <div><dt>{t("facts.observedTiming")}</dt><dd>{formatWindow(candidate.windowBeforeDays, candidate.windowAfterDays, t)}</dd></div>
          <div><dt>{t("facts.observedAmounts")}</dt><dd>{observed.mode === "fixed" ? t("facts.sameAmount") : t("facts.variableAmount", { amount: formatMoney(observed.lowerMedianAmount, t) })}</dd></div>
          {evaluatedOn && <div><dt>{t("facts.evaluated")}</dt><dd>{formatDate(evaluatedOn, t)}</dd></div>}
          <div><dt>{t("facts.detection")}</dt><dd>{candidate.algorithmVersion}</dd></div>
        </dl>
        <PaycheckEvidence evidence={candidate.evidence} disclosure={false} />
      </details>
      {reviewing ? (
        <PaycheckForm key={candidate.fingerprint} mode="confirm" model={editor.model} busy={busy} onSubmit={onConfirm} onCancel={onCancel} />
      ) : (
        <div className="inline-actions paycheck-actions">
          {dismissed ? (
            <button type="button" disabled={actionsDisabled} onClick={() => onDecision(candidate, true)} aria-label={t("actions.reconsiderLabel", { name })}>{t("actions.reconsider")}</button>
          ) : (
            <>
              <button type="button" disabled={actionsDisabled} onClick={(event) => onReview(candidate, event.currentTarget)} aria-label={t("actions.reviewConfirmLabel", { name })}>{t("actions.reviewConfirm")}</button>
              <button type="button" className="button-ghost" disabled={actionsDisabled} onClick={() => onDecision(candidate, false)} aria-label={t("actions.dismissLabel", { name })}>{t("actions.dismiss")}</button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function ProfileCard({ profile, evaluatedOn, busy, actionsDisabled, receiptSubmitDisabled, ending, onEndingChange, editor, onEdit, onCancel, onSave, onLifecycle, receiving, onReceive, onRecord, onRemoveReceipt }) {
  const { t } = useTranslation("paychecks");
  const detailsRef = useRef(null);
  const endTrigger = useRef(null);
  const endConfirm = useRef(null);
  const editing = editor?.mode === "edit" && editor.key === profile.id;
  const projection = profile.lifecycle === "active" ? profile.nextProjection : null;

  useEffect(() => {
    if (ending) endConfirm.current?.focus();
  }, [ending]);

  async function end() {
    const result = await onLifecycle(profile.id, "ended");
    if (result?.ok) onEndingChange(null);
  }

  return (
    <Card as="article" className={`paycheck-card paycheck-card--${profile.lifecycle}`}>
      <header className="paycheck-card__header">
        <div>
          <p className="paycheck-status">{lifecycleLabel(profile.lifecycle, t)}</p>
          <h3>{profile.displayName}</h3>
          <p className="muted">{cadenceLabel(profile.schedule.cadence, t)}</p>
        </div>
        <div className="paycheck-card__amount"><span>{t("card.expectedAmount")}</span><strong>{formatAmount(profile.amount, t)}</strong></div>
      </header>
      {projection ? (
        <div className="paycheck-projection">
          <p className="muted">{t("card.nextWindow")}</p>
          <p className="paycheck-projection__date">{formatDate(projection.earliestExpectedDate, t)}{projection.earliestExpectedDate !== projection.latestExpectedDate && `–${formatDate(projection.latestExpectedDate, t)}`}</p>
          <p>{t("card.notGuaranteed")}</p>
        </div>
      ) : (
        <p className="paycheck-inactive">{profile.lifecycle === "active" ? t("card.noWindowActive") : profile.lifecycle === "paused" ? t("card.noWindowPaused") : profile.lifecycle === "ended" ? t("card.noWindowEnded") : ""}</p>
      )}
      <details ref={detailsRef} className="paycheck-details">
        <summary aria-label={t("card.detailsLabel", { name: profile.displayName })}>{t("card.details")}</summary>
        <dl className="paycheck-facts">
          <div><dt>{t("facts.source")}</dt><dd>{profile.source === "manual" ? t("facts.sourceManual") : t("facts.sourceConfirmed")}</dd></div>
          {profile.origin?.algorithmVersion && <div><dt>{t("facts.detection")}</dt><dd>{profile.origin.algorithmVersion}</dd></div>}
          <div><dt>{t("facts.schedule")}</dt><dd>{formatSchedule(profile.schedule, t)}</dd></div>
          <div><dt>{t("facts.expectedWindow")}</dt><dd>{formatWindow(profile.windowBeforeDays, profile.windowAfterDays, t)}</dd></div>
          <div><dt>{t("facts.linkedDeposits")}</dt><dd>{t("facts.linkedCount", { total: profile.evidence.length })}</dd></div>
          {evaluatedOn && <div><dt>{t("facts.profilesEvaluated")}</dt><dd>{formatDate(evaluatedOn, t)}</dd></div>}
          {projection && <>
            <div><dt>{t("facts.projectionAmount")}</dt><dd>{formatAmount(projection.amount, t)}</dd></div>
            <div><dt>{t("facts.scheduleDate")}</dt><dd>{formatDate(projection.anchor, t)}</dd></div>
            <div><dt>{t("facts.projectionEvaluated")}</dt><dd>{formatDate(projection.evaluatedOn, t)}</dd></div>
            <div><dt>{t("facts.projectionDetails")}</dt><dd>{projection.algorithmVersion}</dd></div>
          </>}
        </dl>
        <PaycheckEvidence evidence={profile.evidence} confirmed disclosure={false} disabled={busy} onRemove={onRemoveReceipt} />
        <p className="muted paycheck-schedule-note">{t("card.scheduleNote")}</p>
        {!editing && !ending && !receiving && <div className="inline-actions paycheck-actions">
          {profile.lifecycle === "ended" && <button type="button" className="button-ghost" disabled={actionsDisabled} onClick={() => onLifecycle(profile.id, "paused")} aria-label={t("actions.pauseLabel", { name: profile.displayName })}>{t("actions.pause")}</button>}
          {profile.lifecycle !== "ended" && <button ref={endTrigger} type="button" className="button-ghost" disabled={actionsDisabled} onClick={() => onEndingChange({ id: profile.id, lifecycle: profile.lifecycle })} aria-label={t("actions.endLabel", { name: profile.displayName })}>{t("actions.end")}</button>}
        </div>}
      </details>
      {receiving ? <ReceiptPanel profile={profile} busy={busy} submitDisabled={receiptSubmitDisabled} onSubmit={onRecord} onCancel={onCancel} /> : editing ? (
        <PaycheckForm key={profile.id} mode="edit" model={editor.model} busy={busy} onSubmit={(payload) => onSave(profile.id, payload)} onCancel={onCancel} />
      ) : ending ? (
        <div className="paycheck-end-confirmation" role="group" aria-label={t("actions.endLabel", { name: profile.displayName })}>
          <p>{t("actions.endPrompt", { name: profile.displayName })}</p>
          <div className="inline-actions">
            <button ref={endConfirm} type="button" disabled={busy} onClick={end}>{t("actions.confirmEnd")}</button>
            <button type="button" className="button-ghost" disabled={busy} onClick={() => { onEndingChange(null); if (detailsRef.current) detailsRef.current.open = true; requestAnimationFrame(() => endTrigger.current?.focus()); }}>{t("actions.cancelEnding")}</button>
          </div>
        </div>
      ) : (
        <div className="inline-actions paycheck-actions">
          {profile.lifecycle === "active" && profile.receiptSlots?.length > 0 && <button type="button" disabled={actionsDisabled} onClick={(event) => onReceive(profile, event.currentTarget)} aria-label={t("actions.recordReceivedLabel", { name: profile.displayName })}>{t("actions.recordReceived")}</button>}
          <button type="button" className="button-ghost" disabled={actionsDisabled} onClick={(event) => onEdit(profile, event.currentTarget)} aria-label={t("actions.editLabel", { name: profile.displayName })}>{t("actions.edit")}</button>
          {profile.lifecycle !== "active" ? (
            <button type="button" disabled={actionsDisabled} onClick={() => onLifecycle(profile.id, "active")} aria-label={t("actions.reactivateLabel", { name: profile.displayName })}>{t("actions.reactivate")}</button>
          ) : (
            <button type="button" className="button-ghost" disabled={actionsDisabled} onClick={() => onLifecycle(profile.id, "paused")} aria-label={t("actions.pauseLabel", { name: profile.displayName })}>{t("actions.pause")}</button>
          )}
        </div>
      )}
    </Card>
  );
}

export default function PaychecksPage() {
  const { t } = useTranslation("paychecks");
  const state = usePaychecks();
  const [editor, setEditor] = useState(null);
  const [endingTarget, setEndingTarget] = useState(null);
  const [receiptTarget, setReceiptTarget] = useState(null);
  const [historyOpen, setHistoryOpen] = useState({ paused: false, ended: false, dismissed: false });
  const editorTrigger = useRef(null);
  const editorLocation = useRef(null);
  const profilesHeading = useRef(null);
  const candidatesHeading = useRef(null);
  const dismissedSummary = useRef(null);
  const feedback = useRef(null);
  const busy = Boolean(state.busyKey) || state.loading || state.refreshing;
  const actionsDisabled = busy || Boolean(editor) || endingTarget !== null || receiptTarget !== null || state.uncertainReceipt;
  const hasContent = state.paychecks.length + state.candidates.length + state.dismissedCandidates.length > 0;
  const showContent = hasContent || (!state.loading && !state.loadError);

  useEffect(() => {
    // Match the former card-local confirmation lifetime when a refresh removes
    // the profile or moves it to another group; same-card refreshes keep it open.
    if (endingTarget && !state.paychecks.some((profile) => profile.id === endingTarget.id && profile.lifecycle === endingTarget.lifecycle)) setEndingTarget(null);
  }, [endingTarget, state.paychecks]);

  function focus(ref) {
    requestAnimationFrame(() => ref.current?.focus());
  }

  function openEditor(mode, model, trigger) {
    editorTrigger.current = trigger;
    editorLocation.current = { container: trigger.closest("article"), label: trigger.getAttribute("aria-label") };
    state.clearMessages();
    setEditor({ mode, model, key: mode === "confirm" ? model.fingerprint : model?.id ?? "manual" });
  }

  function cancelEditor() {
    setEditor(null);
    setReceiptTarget(null);
    requestAnimationFrame(() => {
      const original = editorTrigger.current;
      const location = editorLocation.current;
      const replacement = Array.from(location?.container?.querySelectorAll("button[aria-label]") ?? [])
        .find((button) => button.getAttribute("aria-label") === location.label);
      const target = original?.isConnected ? original : replacement?.isConnected ? replacement : profilesHeading.current;
      target?.focus();
    });
  }

  async function submit(operation) {
    const result = await operation();
    if (result?.ok) {
      setEditor(null);
      setReceiptTarget(null);
      focus(profilesHeading);
    } else if (STALE_CODES.has(result?.code)) {
      setEditor(null);
      setReceiptTarget(null);
      focus(feedback);
    } else {
      focus(feedback);
    }
    return result;
  }

  async function decide(candidate, reconsider) {
    const tuple = { algorithmVersion: candidate.algorithmVersion, cadence: candidate.schedule.cadence, fingerprint: candidate.fingerprint };
    const result = await (reconsider ? state.reconsiderCandidate(tuple) : state.dismissCandidate(tuple));
    if (result?.ok && !reconsider) setHistory("dismissed", true);
    focus(result?.ok ? (reconsider ? candidatesHeading : dismissedSummary) : feedback);
  }

  async function lifecycle(id, value) {
    const result = await state.updateLifecycle(id, value);
    if (result?.ok && value !== "active") setHistoryOpen((current) => ({ ...current, [value]: true }));
    // These targets remain mounted. Delayed focus could steal focus from a
    // subsequent End confirmation opened after the lifecycle read completes.
    (result?.ok ? profilesHeading : feedback).current?.focus();
    return result;
  }

  function setHistory(kind, open) {
    setHistoryOpen((current) => current[kind] === open ? current : { ...current, [kind]: open });
  }

  function profileCard(profile) {
    return <ProfileCard key={profile.id} profile={profile} evaluatedOn={state.paychecksEvaluatedOn}
      busy={busy} actionsDisabled={actionsDisabled} receiptSubmitDisabled={state.uncertainReceipt} ending={endingTarget?.id === profile.id && endingTarget.lifecycle === profile.lifecycle} onEndingChange={setEndingTarget}
      editor={editor} onEdit={(model, trigger) => openEditor("edit", model, trigger)} onCancel={cancelEditor}
      onSave={(id, payload) => submit(() => state.updatePaycheck(id, payload))} onLifecycle={lifecycle}
      receiving={receiptTarget?.id === profile.id}
      onReceive={(model, trigger) => { editorTrigger.current = trigger; editorLocation.current = { container: trigger.closest("article"), label: trigger.getAttribute("aria-label") }; state.clearMessages(); setReceiptTarget(model); }}
      onRecord={(payload) => submit(() => state.recordReceipt(profile.id, payload))}
      onRemoveReceipt={(accountInflowId) => submit(() => state.removeReceipt(profile.id, accountInflowId))} />;
  }

  const activeProfiles = state.paychecks.filter((profile) => profile.lifecycle === "active");

  return (
    <div className="container paychecks-page">
      <header className="page-header">
        <div>
          <h1>{t("page.title")}</h1>
          <p className="muted">{t("page.intro")}</p>
        </div>
        <button type="button" className="paycheck-create" disabled={actionsDisabled || Boolean(state.loadError) || state.uncertainCreate} onClick={(event) => openEditor("manual", null, event.currentTarget)}>
          <Plus size={18} aria-hidden="true" /> {t("page.addManual")}
        </button>
      </header>

      <div ref={feedback} tabIndex={-1} className="paycheck-feedback">
        {state.loadError && <StatusMessage tone="danger">{state.loadError}</StatusMessage>}
        {state.actionError && <StatusMessage tone="danger">{state.actionError}</StatusMessage>}
        {state.notice && <StatusMessage tone="success">{state.notice}</StatusMessage>}
        {(state.loadError || state.actionError) && <button type="button" className="button-ghost" disabled={busy} onClick={() => state.refresh()}>{t("page.refresh")}</button>}
        {state.uncertainCreate && <button type="button" className="button-ghost" disabled={busy} onClick={state.acknowledgeUncertainCreate}>{t("page.acknowledgeCreate")}</button>}
        {state.busyKey && <StatusMessage>{t("page.saving")}</StatusMessage>}
        {state.refreshing && <StatusMessage>{t("page.refreshing")}</StatusMessage>}
      </div>

      {editor?.mode === "manual" && (
        <section className="paycheck-manual" aria-labelledby="manual-paycheck-heading">
          <h2 id="manual-paycheck-heading">{t("manual.heading")}</h2>
          <p className="muted">{t("manual.intro")}</p>
          <PaycheckForm key="manual" mode="manual" busy={busy} submitDisabled={state.uncertainCreate} onSubmit={(payload) => submit(() => state.createPaycheck(payload))} onCancel={cancelEditor} />
        </section>
      )}

      {state.loading && <StatusMessage>{t("page.loading")}</StatusMessage>}
      {showContent && (
        <>
          <section className="paycheck-section" aria-labelledby="paycheck-profiles-heading" aria-busy={Boolean(state.busyKey)}>
            <header className="paycheck-section__header">
              <h2 id="paycheck-profiles-heading" ref={profilesHeading} tabIndex={-1}>{t("profiles.heading")}</h2>
            </header>
            {activeProfiles.length === 0 ? (
              <div className="paycheck-empty"><WalletCards size={28} aria-hidden="true" /><h3>{state.paychecks.length === 0 ? t("profiles.emptyNone") : t("profiles.emptyNoActive")}</h3><p>{t("profiles.emptyBody")}</p></div>
            ) : (
              <div className="paycheck-group" role="group" aria-label={t("groups.active")}>
                {activeProfiles.map(profileCard)}
              </div>
            )}
          </section>

          <section className="paycheck-section" aria-labelledby="paycheck-candidates-heading">
            <header className="paycheck-section__header">
              <div><h2 id="paycheck-candidates-heading" ref={candidatesHeading} tabIndex={-1}>{t("candidates.heading")}</h2><p className="muted">{t("candidates.intro")}</p></div>
              {state.candidates.length > 0 && <p className="muted">{t("candidates.toReview", { total: state.candidates.length })}</p>}
            </header>
            {state.candidates.length === 0 ? <p className="paycheck-empty">{t("candidates.none")}</p> : state.candidates.map((candidate) => <CandidateCard key={candidate.fingerprint} candidate={candidate} evaluatedOn={state.candidatesEvaluatedOn} busy={busy} actionsDisabled={actionsDisabled} editor={editor} onReview={(model, trigger) => openEditor("confirm", model, trigger)} onCancel={cancelEditor} onConfirm={(payload) => submit(() => state.confirmCandidate(payload))} onDecision={decide} />)}
          </section>

          {["paused", "ended"].map((kind) => {
            const profiles = state.paychecks.filter((profile) => profile.lifecycle === kind);
            const locked = profiles.some((profile) => (endingTarget?.id === profile.id && endingTarget.lifecycle === profile.lifecycle) || (editor?.mode === "edit" && editor.key === profile.id) || state.busyKey === `lifecycle:${profile.id}`);
            return profiles.length > 0 && (
              <details key={kind} className="paycheck-history" open={historyOpen[kind] || locked} onToggle={(event) => { if (!locked) setHistory(kind, event.currentTarget.open); }}>
                <summary aria-disabled={locked || undefined} onClick={(event) => { if (locked) event.preventDefault(); }}><h2>{t(`groups.${kind}`)} <span>({profiles.length})</span></h2></summary>
                <div className="paycheck-history__content paycheck-group" role="group" aria-label={t(`groups.${kind}`)}>
                  {locked && <p className="muted paycheck-history-note">{t("groups.locked")}</p>}
                  {profiles.map(profileCard)}
                </div>
              </details>
            );
          })}

          <details className="paycheck-history" open={historyOpen.dismissed || state.busyKey?.startsWith("reconsider:")} onToggle={(event) => { if (!state.busyKey?.startsWith("reconsider:")) setHistory("dismissed", event.currentTarget.open); }}>
            <summary ref={dismissedSummary} aria-disabled={state.busyKey?.startsWith("reconsider:") || undefined} onClick={(event) => { if (state.busyKey?.startsWith("reconsider:")) event.preventDefault(); }}><h2 id="paycheck-dismissed-heading">{t("candidates.dismissedHeading")} <span>({state.dismissedCandidates.length})</span></h2></summary>
            <div className="paycheck-history__content">
              <p className="muted">{t("candidates.dismissedIntro")}</p>
              {state.dismissedCandidates.length === 0 ? <p className="muted">{t("candidates.dismissedNone")}</p> : state.dismissedCandidates.map((candidate) => <CandidateCard key={candidate.fingerprint} candidate={candidate} evaluatedOn={state.candidatesEvaluatedOn} dismissed busy={busy} actionsDisabled={actionsDisabled} onDecision={decide} />)}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
