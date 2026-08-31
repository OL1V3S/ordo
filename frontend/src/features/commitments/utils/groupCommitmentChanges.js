function assessmentEntries(change) {
  const entries = [];
  if (change.amount?.state === "proposed_change" && change.amount.fingerprint) {
    entries.push({ dimension: "amount", assessment: change.amount });
  }
  if (change.timing?.state === "proposed_change" && change.timing.fingerprint) {
    entries.push({ dimension: "timing", assessment: change.timing });
  }
  if (
    ["not_seen_recently", "possibly_ended"].includes(change.missing?.state)
    && change.missing.fingerprint
  ) {
    entries.push({ dimension: "missing", assessment: change.missing });
  }
  return entries;
}

export default function groupCommitmentChanges(changes, decisionState) {
  return changes.flatMap((change) => {
    const assessments = assessmentEntries(change)
      .filter(({ assessment }) => assessment.decisionState === decisionState);
    return assessments.length ? [{ ...change, assessments }] : [];
  });
}
