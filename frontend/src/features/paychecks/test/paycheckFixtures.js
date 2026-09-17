export const evaluatedOn = "2026-07-12";

const fingerprint = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeSchedule() {
  return {
    cadence: "monthly",
    referenceAnchorDate: null,
    firstMonthAnchor: { kind: "day_of_month", day: 10 },
    secondMonthAnchor: null,
  };
}

function makeAmount() {
  return {
    mode: "fixed",
    fixedAmount: 2500,
    minimumAmount: null,
    maximumAmount: null,
  };
}

function makeCandidateEvidence() {
  return [
    {
      accountInflowId: 101,
      postedDate: "2026-05-10",
      amount: 2500,
      description: "Acme Payroll",
      source: "imported",
      slotAnchor: "2026-05-10",
      timingOffsetDays: 0,
    },
    {
      accountInflowId: 102,
      postedDate: "2026-06-10",
      amount: 2500,
      description: "Acme Payroll",
      source: "manual",
      slotAnchor: "2026-06-10",
      timingOffsetDays: 0,
    },
    {
      accountInflowId: 103,
      postedDate: "2026-07-10",
      amount: 2500,
      description: "Acme Payroll",
      source: "imported",
      slotAnchor: "2026-07-10",
      timingOffsetDays: 0,
    },
  ];
}

function makeProfileEvidence() {
  return makeCandidateEvidence().map((evidence, index) => ({
    ...evidence,
    linkedAt: `2026-07-12T0${index + 1}:00:00.000Z`,
    editedSinceConfirmation: false,
  }));
}

function makeProjection() {
  return {
    algorithmVersion: "paycheck-projector-v1",
    evaluatedOn,
    anchor: "2026-08-10",
    earliestExpectedDate: "2026-08-09",
    latestExpectedDate: "2026-08-11",
    amount: makeAmount(),
  };
}

export function makeCandidate(overrides = {}) {
  return {
    fingerprint,
    algorithmVersion: "paycheck-candidate-v1",
    normalizedDescriptionIdentity: "acme payroll",
    schedule: makeSchedule(),
    windowBeforeDays: 1,
    windowAfterDays: 1,
    observedAmount: {
      mode: "fixed",
      fixedAmount: 2500,
      minimumAmount: null,
      maximumAmount: null,
      lowerMedianAmount: 2500,
    },
    coveredFrom: "2026-05-10",
    coveredTo: "2026-07-10",
    occurrenceCount: 3,
    evidence: makeCandidateEvidence(),
    ...overrides,
  };
}

export function makePaycheck(overrides = {}) {
  return {
    id: "8a8a5c92-8a4f-4a41-9e2f-2d4b1c6d7e8f",
    displayName: "Acme Payroll",
    lifecycle: "active",
    schedule: makeSchedule(),
    windowBeforeDays: 1,
    windowAfterDays: 1,
    amount: makeAmount(),
    source: "candidate",
    origin: {
      algorithmVersion: "paycheck-candidate-v1",
      fingerprint,
    },
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    evidence: makeProfileEvidence().map((row) => ({ ...row, assignmentKind: "confirmation_evidence" })),
    receiptSlots: [
      { relation: "current", anchor: "2026-08-10", earliestExpectedDate: "2026-08-09", latestExpectedDate: "2026-08-11" },
      { relation: "previous", anchor: "2026-07-10", earliestExpectedDate: "2026-07-09", latestExpectedDate: "2026-07-11" },
    ],
    nextProjection: makeProjection(),
    ...overrides,
  };
}

export function makeCandidateResponse(overrides = {}) {
  return {
    evaluatedOn,
    candidates: [makeCandidate()],
    dismissedCandidates: [],
    ...overrides,
  };
}

export function makePaychecksResponse(overrides = {}) {
  return {
    evaluatedOn,
    paychecks: [makePaycheck()],
    ...overrides,
  };
}
