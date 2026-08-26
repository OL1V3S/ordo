import { useState } from "react";
import Card from "../../../shared/ui/Card";
import StatusMessage from "../../../shared/ui/StatusMessage";
import CommitmentEvidence from "../components/CommitmentEvidence";
import CommitmentForm from "../components/CommitmentForm";
import { useCommitments } from "../hooks/useCommitments";
import { formatDate, formatMoney } from "../utils/formatCommitments";

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
  if (model.cadence === "monthly" && model.timingKind === "monthend") return `Month end, up to ${model.windowBeforeDays} day(s) before`;
  if (model.cadence === "yearly") return `Month ${model.expectedMonth}, day ${model.expectedDay}, with a ${model.windowBeforeDays}-day before / ${model.windowAfterDays}-day after window`;
  return `Day ${model.expectedDay}, with a ${model.windowBeforeDays}-day before / ${model.windowAfterDays}-day after window`;
}

function amountSummary(model) {
  const mode = model.amountMode ?? model.observedAmountMode;
  if (mode === "fixed") return formatMoney(model.expectedAmount ?? model.observedMedianAmount);
  return `${formatMoney(model.expectedMinimumAmount ?? model.observedMinimumAmount)}–${formatMoney(model.expectedMaximumAmount ?? model.observedMaximumAmount)}`;
}

function CandidateCard({ candidate, dismissed, state }) {
  const [reviewing, setReviewing] = useState(false);
  const busy = state.busyKey?.endsWith(candidate.fingerprint);

  async function confirm(payload) {
    const result = await state.confirmCandidate(payload);
    if (result) setReviewing(false);
  }

  return (
    <Card as="article" className="commitment-card">
      <div className="commitment-card__header">
        <div>
          <p className="commitment-card__eyebrow">{dismissed ? "Dismissed proposal" : "Needs your review"}</p>
          <h3>{candidate.description}</h3>
          <p className="muted">{candidate.category} · {title(candidate.cadence)}</p>
        </div>
        <strong className="commitment-card__amount">{amountSummary(candidate)}</strong>
      </div>

      <dl className="commitment-facts">
        <div><dt>Evidence</dt><dd>{candidate.occurrenceCount} expenses · {EVIDENCE_RULES[candidate.evidenceRule] ?? title(candidate.evidenceRule)}</dd></div>
        <div><dt>Covered period</dt><dd>{formatDate(candidate.coveredFrom)}–{formatDate(candidate.coveredTo)}</dd></div>
        <div><dt>Observed timing</dt><dd>{timingSummary(candidate)}</dd></div>
        <div><dt>Observed amount</dt><dd>{candidate.observedAmountMode === "fixed" ? "Identical each time" : `Median ${formatMoney(candidate.observedMedianAmount)}`}</dd></div>
        <div><dt>Rule version</dt><dd>{candidate.algorithmVersion}</dd></div>
      </dl>

      <CommitmentEvidence evidence={candidate.evidence} />

      {reviewing ? (
        <CommitmentForm
          model={candidate}
          fingerprint={candidate.fingerprint}
          submitLabel="Confirm commitment"
          busy={busy}
          onSubmit={confirm}
          onCancel={() => setReviewing(false)}
        />
      ) : (
        <div className="inline-actions commitment-card__actions">
          {dismissed ? (
            <button type="button" disabled={busy} onClick={() => state.reconsiderCandidate(candidate.fingerprint)}>
              {busy ? "Updating..." : "Reconsider"}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => { state.clearMessages(); setReviewing(true); }}>Review and confirm</button>
              <button type="button" className="button-ghost" disabled={busy} onClick={() => state.dismissCandidate(candidate.fingerprint)}>
                {busy ? "Dismissing..." : "Dismiss"}
              </button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function ConfirmedCommitmentCard({ commitment, state }) {
  const [editing, setEditing] = useState(false);
  const [lifecycle, setLifecycle] = useState(commitment.lifecycle);
  const busy = state.busyKey?.endsWith(commitment.id);

  async function save(payload) {
    const result = await state.updateCommitment(commitment.id, payload);
    if (result) setEditing(false);
  }

  async function saveLifecycle() {
    await state.updateLifecycle(commitment.id, lifecycle);
  }

  return (
    <Card as="article" className="commitment-card commitment-card--confirmed">
      <div className="commitment-card__header">
        <div>
          <p className="commitment-card__eyebrow">Confirmed · {title(commitment.lifecycle)}</p>
          <h3>{commitment.name}</h3>
          <p className="muted">{commitment.category} · {title(commitment.cadence)}</p>
        </div>
        <strong className="commitment-card__amount">{amountSummary(commitment)}</strong>
      </div>

      <dl className="commitment-facts">
        <div><dt>Expected timing</dt><dd>{timingSummary(commitment)}</dd></div>
        <div><dt>Confirmation evidence</dt><dd>{commitment.evidence.length} linked expense(s)</dd></div>
      </dl>

      <CommitmentEvidence evidence={commitment.evidence} />

      {editing ? (
        <CommitmentForm model={commitment} submitLabel="Save changes" busy={busy} onSubmit={save} onCancel={() => setEditing(false)} />
      ) : (
        <div className="commitment-controls">
          <button type="button" className="button-ghost" onClick={() => { state.clearMessages(); setEditing(true); }}>Edit expectation</button>
          <label className="field commitment-lifecycle">
            <span className="field__label">Lifecycle</span>
            <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="ended">Ended</option>
            </select>
          </label>
          <button type="button" disabled={busy || lifecycle === commitment.lifecycle} onClick={saveLifecycle}>
            {busy ? "Updating..." : "Update status"}
          </button>
        </div>
      )}
    </Card>
  );
}

export default function CommitmentsPage() {
  const state = useCommitments();

  return (
    <div className="container commitments-page">
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Promises your money keeps</p>
          <h1>Commitments</h1>
          <p className="muted">Review patterns from your expenses. Nothing becomes a commitment until you confirm it.</p>
        </div>
      </header>

      {state.loadError && <StatusMessage tone="danger">{state.loadError}</StatusMessage>}
      {state.actionError && <StatusMessage tone="danger">{state.actionError}</StatusMessage>}
      {state.notice && <StatusMessage tone="success">{state.notice}</StatusMessage>}

      {state.loading ? (
        <StatusMessage>Loading commitments...</StatusMessage>
      ) : state.loadError ? (
        <button type="button" onClick={() => state.refresh()}>Try again</button>
      ) : (
        <>
          <section className="commitment-section" aria-labelledby="candidate-heading">
            <div className="commitment-section__header">
              <div>
                <h2 id="candidate-heading">Proposals to review</h2>
                <p className="muted">Each proposal passed a deterministic evidence rule. Check the expenses and correct the expectation before confirming.</p>
              </div>
              <span className="commitment-count">{state.candidates.length}</span>
            </div>
            {state.candidates.length === 0 ? (
              <p className="empty-state">No commitment proposals need your review.</p>
            ) : (
              <div className="commitment-list">
                {state.candidates.map((candidate) => <CandidateCard key={candidate.fingerprint} candidate={candidate} state={state} />)}
              </div>
            )}
          </section>

          <section className="commitment-section" aria-labelledby="confirmed-heading">
            <div className="commitment-section__header">
              <div>
                <h2 id="confirmed-heading">Confirmed commitments</h2>
                <p className="muted">These are your saved expectations. Edit their details or set them active, paused, or ended.</p>
              </div>
              <span className="commitment-count">{state.commitments.length}</span>
            </div>
            {state.commitments.length === 0 ? (
              <p className="empty-state">No commitments confirmed yet.</p>
            ) : (
              <div className="commitment-list">
                {state.commitments.map((commitment) => <ConfirmedCommitmentCard key={commitment.id} commitment={commitment} state={state} />)}
              </div>
            )}
          </section>

          <section className="commitment-section" aria-labelledby="dismissed-heading">
            <div className="commitment-section__header">
              <div>
                <h2 id="dismissed-heading">Dismissed proposals</h2>
                <p className="muted">Dismissals apply only to the exact evidence you reviewed. Reconsider one to return it to your review list.</p>
              </div>
              <span className="commitment-count">{state.dismissedCandidates.length}</span>
            </div>
            {state.dismissedCandidates.length === 0 ? (
              <p className="empty-state">No dismissed proposals.</p>
            ) : (
              <div className="commitment-list">
                {state.dismissedCandidates.map((candidate) => <CandidateCard key={candidate.fingerprint} candidate={candidate} dismissed state={state} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
