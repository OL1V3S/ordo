using BudgetPlanner.Commitments;
using BudgetPlanner.Models;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

public sealed class CommitmentChangeDetectorTests
{
    private const string Owner = "owner";
    private readonly CommitmentChangeDetector _detector = new();

    [Fact]
    public void Matching_uses_confirmation_identity_normalization_and_owner_scope()
    {
        var commitment = Monthly();
        var expenses = new[]
        {
            Expense(10, new DateOnly(2026, 3, 16), 10m, "  GYM   CLUB ", " Health "),
            Expense(11, new DateOnly(2026, 4, 15), 10m, "gym club", "health", "other"),
            Expense(12, new DateOnly(2026, 4, 15), 10m, "different", "health")
        };

        var result = Detect(commitment, expenses, new DateOnly(2026, 4, 20));

        Assert.True(result.IsMatchingAvailable);
        var observation = Assert.Single(result.Observations);
        Assert.Equal(10, observation.Expense.Id);
        Assert.Equal("gym club", result.NormalizedDescription);
        Assert.Equal("health", result.CanonicalCategory);
    }

    [Theory]
    [InlineData(false, CommitmentMatchingUnavailableReason.InsufficientConfirmationEvidence)]
    [InlineData(true, CommitmentMatchingUnavailableReason.InconsistentConfirmationIdentity)]
    public void Matching_requires_two_consistent_surviving_confirmation_expenses(
        bool addInconsistentEvidence,
        CommitmentMatchingUnavailableReason reason)
    {
        var commitment = Monthly();
        commitment.Occurrences.RemoveAt(0);
        if (addInconsistentEvidence)
            commitment.Occurrences.Add(Link(Expense(99, new DateOnly(2026, 2, 15), 10m, "other")));

        var result = Detect(commitment, [], new DateOnly(2026, 4, 20));

        Assert.False(result.IsMatchingAvailable);
        Assert.Equal(reason, result.UnavailableReason);
    }

    [Fact]
    public void Shared_identity_fails_closed_only_for_active_commitments()
    {
        var first = Monthly(Guid.Parse("00000000-0000-0000-0000-000000000001"));
        var second = Monthly(Guid.Parse("00000000-0000-0000-0000-000000000002"));

        var shared = _detector.Detect(Owner, [first, second], [], new DateOnly(2026, 4, 20));

        Assert.All(shared, value =>
        {
            Assert.False(value.IsMatchingAvailable);
            Assert.Equal(CommitmentMatchingUnavailableReason.SharedActiveIdentity, value.UnavailableReason);
        });

        second.Lifecycle = CommitmentLifecycle.Paused;
        var withoutPaused = _detector.Detect(Owner, [first, second], [], new DateOnly(2026, 4, 20));
        Assert.True(Assert.Single(withoutPaused).IsMatchingAvailable);
    }

    [Fact]
    public void Confirmation_evidence_for_another_active_commitment_is_never_reused()
    {
        var target = Monthly(Guid.Parse("00000000-0000-0000-0000-000000000001"));
        var other = Monthly(Guid.Parse("00000000-0000-0000-0000-000000000002"));
        var linkedFutureExpense = Expense(10, new DateOnly(2026, 3, 15), 10m);
        other.Name = "Different commitment";
        other.Category = "different category";
        other.Occurrences = [Link(linkedFutureExpense)];

        var results = _detector.Detect(
            Owner,
            [target, other],
            [linkedFutureExpense],
            new DateOnly(2026, 3, 20));

        var targetResult = Assert.Single(results, value => value.CommitmentId == target.Id);
        Assert.Empty(targetResult.Observations);
        Assert.Equal(
            CommitmentMatchingUnavailableReason.InsufficientConfirmationEvidence,
            Assert.Single(results, value => value.CommitmentId == other.Id).UnavailableReason);
    }

    [Theory]
    [InlineData(CommitmentLifecycle.Paused)]
    [InlineData(CommitmentLifecycle.Ended)]
    public void Paused_or_ended_same_identity_confirmation_evidence_is_never_reused(
        CommitmentLifecycle lifecycle)
    {
        var target = Monthly(Guid.Parse("00000000-0000-0000-0000-000000000001"));
        var inactive = Monthly(Guid.Parse("00000000-0000-0000-0000-000000000002"));
        var march = Expense(10, new DateOnly(2026, 3, 15), 10m);
        var april = Expense(11, new DateOnly(2026, 4, 15), 10m);
        inactive.Lifecycle = lifecycle;
        inactive.Occurrences = [Link(march), Link(april)];

        var result = Assert.Single(_detector.Detect(
            Owner,
            [target, inactive],
            [march, april],
            new DateOnly(2026, 4, 20)));

        Assert.True(result.IsMatchingAvailable);
        Assert.Empty(result.Observations);
    }

    [Fact]
    public void Identical_unlinked_expense_remains_eligible_when_linked_expenses_are_excluded()
    {
        var target = Monthly(Guid.Parse("00000000-0000-0000-0000-000000000001"));
        var paused = Monthly(Guid.Parse("00000000-0000-0000-0000-000000000002"));
        var linkedMarch = Expense(10, new DateOnly(2026, 3, 15), 10m);
        var linkedApril = Expense(11, new DateOnly(2026, 4, 15), 10m);
        var unlinkedMay = Expense(12, new DateOnly(2026, 5, 15), 10m);
        paused.Lifecycle = CommitmentLifecycle.Paused;
        paused.Occurrences = [Link(linkedMarch), Link(linkedApril)];

        var result = Assert.Single(_detector.Detect(
            Owner,
            [target, paused],
            [linkedMarch, linkedApril, unlinkedMay],
            new DateOnly(2026, 5, 20)));

        Assert.Equal(12, Assert.Single(result.Observations).Expense.Id);
    }

    [Fact]
    public void Monthly_plausibility_is_bounded_to_six_days_and_far_evidence_is_ignored()
    {
        var commitment = Monthly();
        var result = Detect(commitment,
        [
            Expense(10, new DateOnly(2026, 3, 21), 11m),
            Expense(11, new DateOnly(2026, 4, 22), 11m)
        ], new DateOnly(2026, 4, 25));

        var observation = Assert.Single(result.Observations);
        Assert.Equal(10, observation.Expense.Id);
        Assert.Equal(6, observation.TimingOffsetDays);
    }

    [Fact]
    public void Weekly_plausibility_uses_the_nearest_anchor_with_three_day_edges()
    {
        var commitment = Weekly();
        var result = Detect(commitment,
        [
            Expense(10, new DateOnly(2026, 3, 5), 11m),
            Expense(11, new DateOnly(2026, 3, 13), 11m)
        ], new DateOnly(2026, 3, 15));

        Assert.Collection(result.Observations,
            observation =>
            {
                Assert.Equal(10, observation.Expense.Id);
                Assert.Equal(new DateOnly(2026, 3, 2), observation.SlotAnchor);
                Assert.Equal(3, observation.TimingOffsetDays);
            },
            observation =>
            {
                Assert.Equal(11, observation.Expense.Id);
                Assert.Equal(new DateOnly(2026, 3, 16), observation.SlotAnchor);
                Assert.Equal(-3, observation.TimingOffsetDays);
            });
    }

    [Fact]
    public void Weekly_first_slot_uses_edited_weekday_in_next_week_when_confirmation_is_earlier()
    {
        var commitment = WeeklyWithLatestConfirmation(new DateOnly(2026, 3, 2));
        commitment.ExpectedDayOfWeek = DayOfWeek.Friday;

        var result = Detect(commitment,
        [Expense(10, new DateOnly(2026, 3, 13), 10m)], new DateOnly(2026, 3, 14));

        Assert.Equal(new DateOnly(2026, 3, 13), Assert.Single(result.Observations).SlotAnchor);
    }

    [Fact]
    public void Weekly_first_slot_uses_edited_weekday_in_next_week_when_confirmation_is_later()
    {
        var commitment = WeeklyWithLatestConfirmation(new DateOnly(2026, 3, 6));
        commitment.ExpectedDayOfWeek = DayOfWeek.Monday;

        var result = Detect(commitment,
        [Expense(10, new DateOnly(2026, 3, 9), 10m)], new DateOnly(2026, 3, 10));

        Assert.Equal(new DateOnly(2026, 3, 9), Assert.Single(result.Observations).SlotAnchor);
    }

    [Fact]
    public void Weekly_first_slot_preserves_next_iso_week_across_year_boundary()
    {
        var commitment = WeeklyWithLatestConfirmation(new DateOnly(2025, 12, 29));
        commitment.ExpectedDayOfWeek = DayOfWeek.Friday;

        var result = Detect(commitment,
        [Expense(10, new DateOnly(2026, 1, 9), 10m)], new DateOnly(2026, 1, 10));

        Assert.Equal(new DateOnly(2026, 1, 9), Assert.Single(result.Observations).SlotAnchor);
    }

    [Fact]
    public void Explicit_larger_window_expands_plausibility_and_nearest_anchor_wins_overlap()
    {
        var commitment = Monthly();
        commitment.WindowBeforeDays = 20;
        commitment.WindowAfterDays = 20;

        var result = Detect(commitment,
        [Expense(10, new DateOnly(2026, 3, 29), 10m)], new DateOnly(2026, 4, 2));

        var observation = Assert.Single(result.Observations);
        Assert.Equal(new DateOnly(2026, 3, 15), observation.SlotAnchor);
    }

    [Fact]
    public void Equidistant_overlapping_slot_tie_is_ambiguous_and_not_missing()
    {
        var commitment = Monthly();
        commitment.Occurrences = Confirmation(commitment, new DateOnly(2026, 2, 15));
        commitment.WindowBeforeDays = 20;
        commitment.WindowAfterDays = 20;

        var result = Detect(commitment,
        [Expense(10, new DateOnly(2026, 4, 30), 10m)], new DateOnly(2026, 6, 1));

        Assert.Empty(result.Observations);
        Assert.Equal(CommitmentChangeState.WithinExpectation, result.Missing.State);
    }

    [Fact]
    public void Multiple_expenses_in_one_slot_are_ambiguous_and_never_count_as_missing()
    {
        var commitment = Monthly();
        var result = Detect(commitment,
        [
            Expense(10, new DateOnly(2026, 3, 14), 10m),
            Expense(11, new DateOnly(2026, 3, 16), 10m)
        ], new DateOnly(2026, 4, 1));

        Assert.Empty(result.Observations);
        Assert.Equal(CommitmentChangeState.WithinExpectation, result.Missing.State);
    }

    [Theory]
    [InlineData(1, CommitmentChangeState.IsolatedOutlier)]
    [InlineData(2, CommitmentChangeState.PossibleChange)]
    [InlineData(3, CommitmentChangeState.ProposedChange)]
    public void Fixed_amount_uses_one_two_three_consecutive_deviation_states(
        int count,
        CommitmentChangeState state)
    {
        var commitment = Monthly();
        var expenses = Enumerable.Range(1, count)
            .Select(index => Expense(10 + index, new DateOnly(2026, 2 + index, 15), 12m))
            .ToArray();

        var result = Detect(commitment, expenses, new DateOnly(2026, 2 + count, 20));

        Assert.Equal(state, result.Amount.State);
        Assert.Equal(count, result.Amount.Evidence.Count);
        Assert.NotNull(result.Amount.Fingerprint);
        if (count == 3)
        {
            Assert.Equal(CommitmentAmountMode.Fixed, result.Amount.ProposedMode);
            Assert.Equal(12m, result.Amount.ProposedAmount);
        }
    }

    [Fact]
    public void Variable_deviation_run_proposes_observed_range_and_lower_median()
    {
        var commitment = Monthly();
        commitment.AmountMode = CommitmentAmountMode.Range;
        commitment.ExpectedAmount = null;
        commitment.ExpectedMinimumAmount = 9m;
        commitment.ExpectedMaximumAmount = 11m;

        var result = Detect(commitment,
        [
            Expense(10, new DateOnly(2026, 3, 15), 13m),
            Expense(11, new DateOnly(2026, 4, 15), 12m),
            Expense(12, new DateOnly(2026, 5, 15), 15m)
        ], new DateOnly(2026, 5, 20));

        Assert.Equal(CommitmentChangeState.ProposedChange, result.Amount.State);
        Assert.Equal(CommitmentAmountMode.Range, result.Amount.ProposedMode);
        Assert.Equal(12m, result.Amount.ProposedMinimumAmount);
        Assert.Equal(15m, result.Amount.ProposedMaximumAmount);
        Assert.Equal(13m, result.Amount.ObservedMedianAmount);
    }

    [Fact]
    public void Baseline_amount_or_closed_gap_breaks_amount_run()
    {
        var commitment = Monthly();
        var result = Detect(commitment,
        [
            Expense(10, new DateOnly(2026, 3, 15), 12m),
            Expense(11, new DateOnly(2026, 4, 15), 10m),
            Expense(12, new DateOnly(2026, 6, 15), 12m)
        ], new DateOnly(2026, 6, 20));

        Assert.Equal(CommitmentChangeState.IsolatedOutlier, result.Amount.State);
        Assert.Equal(12, Assert.Single(result.Amount.Evidence).Expense.Id);
    }

    [Fact]
    public void Ambiguous_current_slot_immediately_breaks_an_amount_run()
    {
        var commitment = Monthly();
        var result = Detect(commitment,
        [
            Expense(10, new DateOnly(2026, 3, 15), 12m),
            Expense(11, new DateOnly(2026, 4, 14), 12m),
            Expense(12, new DateOnly(2026, 4, 16), 12m)
        ], new DateOnly(2026, 4, 16));

        Assert.Equal(CommitmentChangeState.WithinExpectation, result.Amount.State);
        Assert.Equal(CommitmentChangeState.WithinExpectation, result.Timing.State);
    }

    [Theory]
    [InlineData(1, CommitmentChangeState.IsolatedOutlier)]
    [InlineData(2, CommitmentChangeState.PossibleChange)]
    [InlineData(3, CommitmentChangeState.ProposedChange)]
    public void Timing_uses_one_two_three_same_side_deviation_states(
        int count,
        CommitmentChangeState state)
    {
        var commitment = Monthly();
        var expenses = Enumerable.Range(1, count)
            .Select(index => Expense(10 + index, new DateOnly(2026, 2 + index, 18), 10m))
            .ToArray();

        var result = Detect(commitment, expenses, new DateOnly(2026, 2 + count, 20));

        Assert.Equal(state, result.Timing.State);
        if (count == 3)
        {
            Assert.Equal(CommitmentTimingKind.DayOfMonth, result.Timing.ProposedTimingKind);
            Assert.Equal(18, result.Timing.ProposedDay);
            Assert.Equal(0, result.Timing.ProposedWindowBeforeDays);
            Assert.Equal(0, result.Timing.ProposedWindowAfterDays);
        }
    }

    [Fact]
    public void Timing_direction_change_breaks_the_run()
    {
        var commitment = Monthly();
        var result = Detect(commitment,
        [
            Expense(10, new DateOnly(2026, 3, 18), 10m),
            Expense(11, new DateOnly(2026, 4, 12), 10m)
        ], new DateOnly(2026, 4, 20));

        Assert.Equal(CommitmentChangeState.IsolatedOutlier, result.Timing.State);
        Assert.Equal(11, Assert.Single(result.Timing.Evidence).Expense.Id);
    }

    [Theory]
    [InlineData(CommitmentCadence.Weekly, 1, CommitmentChangeState.WithinExpectation)]
    [InlineData(CommitmentCadence.Weekly, 2, CommitmentChangeState.NotSeenRecently)]
    [InlineData(CommitmentCadence.Weekly, 3, CommitmentChangeState.PossiblyEnded)]
    [InlineData(CommitmentCadence.Monthly, 1, CommitmentChangeState.WithinExpectation)]
    [InlineData(CommitmentCadence.Monthly, 2, CommitmentChangeState.NotSeenRecently)]
    [InlineData(CommitmentCadence.Monthly, 3, CommitmentChangeState.PossiblyEnded)]
    [InlineData(CommitmentCadence.Yearly, 1, CommitmentChangeState.NotSeenRecently)]
    [InlineData(CommitmentCadence.Yearly, 2, CommitmentChangeState.PossiblyEnded)]
    public void Missing_thresholds_are_cadence_aware(
        CommitmentCadence cadence,
        int missed,
        CommitmentChangeState state)
    {
        var commitment = cadence switch
        {
            CommitmentCadence.Weekly => Weekly(),
            CommitmentCadence.Monthly => Monthly(),
            _ => Yearly()
        };
        var latest = commitment.Occurrences.Max(value => value.Expense!.Date);
        var today = cadence switch
        {
            CommitmentCadence.Weekly => latest.AddDays(7 * missed + 4),
            CommitmentCadence.Monthly => latest.AddMonths(missed).AddDays(4),
            _ => latest.AddYears(missed).AddDays(7)
        };

        var result = Detect(commitment, [], today);

        Assert.Equal(state, result.Missing.State);
        Assert.Equal(missed, result.Missing.MissedSlotAnchors.Count);
        Assert.Equal(state == CommitmentChangeState.WithinExpectation, result.Missing.Fingerprint is null);
    }

    [Fact]
    public void Late_but_plausible_observation_is_timing_evidence_not_missing()
    {
        var commitment = Monthly();
        var result = Detect(commitment,
        [Expense(10, new DateOnly(2026, 3, 20), 10m)], new DateOnly(2026, 3, 25));

        Assert.Equal(CommitmentChangeState.IsolatedOutlier, result.Timing.State);
        Assert.Equal(CommitmentChangeState.WithinExpectation, result.Missing.State);
    }

    [Fact]
    public void Yearly_february_29_anchor_clamps_in_non_leap_year()
    {
        var commitment = Yearly();
        commitment.ExpectedDay = 29;
        var result = Detect(commitment,
        [Expense(10, new DateOnly(2027, 2, 28), 100m)], new DateOnly(2027, 3, 5));

        Assert.Equal(new DateOnly(2027, 2, 28), Assert.Single(result.Observations).SlotAnchor);
        Assert.Equal(CommitmentChangeState.WithinExpectation, result.Timing.State);
    }

    [Fact]
    public void Far_away_yearly_identity_match_does_not_suppress_missing()
    {
        var commitment = Yearly();
        var result = Detect(commitment,
        [Expense(10, new DateOnly(2026, 9, 1), 100m)], new DateOnly(2027, 3, 7));

        Assert.Empty(result.Observations);
        Assert.Equal(CommitmentChangeState.NotSeenRecently, result.Missing.State);
        Assert.Equal(new DateOnly(2027, 2, 28), Assert.Single(result.Missing.MissedSlotAnchors));
    }

    [Fact]
    public void Fingerprint_ignores_presentation_edits_but_tracks_semantics_and_evidence_revision()
    {
        var commitment = Monthly();
        var expenses = new[]
        {
            Expense(10, new DateOnly(2026, 3, 15), 12m),
            Expense(11, new DateOnly(2026, 4, 15), 12m)
        };
        var first = Detect(commitment, expenses, new DateOnly(2026, 4, 20)).Amount.Fingerprint;

        commitment.Name = "Presentation only";
        commitment.Category = "display category";
        commitment.UpdatedAt = commitment.UpdatedAt.AddDays(1);
        var presentationEdit = Detect(commitment, expenses, new DateOnly(2026, 4, 20)).Amount.Fingerprint;
        Assert.Equal(first, presentationEdit);

        commitment.ExpectedAmount = 9m;
        var baselineEdit = Detect(commitment, expenses, new DateOnly(2026, 4, 20)).Amount.Fingerprint;
        Assert.NotEqual(first, baselineEdit);

        commitment.ExpectedAmount = 10m;
        expenses[0].CommitmentEvidenceRevision = Guid.NewGuid();
        var evidenceEdit = Detect(commitment, expenses, new DateOnly(2026, 4, 20)).Amount.Fingerprint;
        Assert.NotEqual(first, evidenceEdit);

        expenses[0].CommitmentEvidenceRevision = Guid.Parse("00000000-0000-0000-0000-000000000010");
        commitment.Occurrences[0].Expense!.CommitmentEvidenceRevision = Guid.NewGuid();
        var confirmationEdit = Detect(commitment, expenses, new DateOnly(2026, 4, 20)).Amount.Fingerprint;
        Assert.NotEqual(first, confirmationEdit);
    }

    [Fact]
    public void Missing_fingerprint_is_stable_within_the_same_closed_slot()
    {
        var commitment = Monthly();

        var first = Detect(commitment, [], new DateOnly(2026, 4, 20)).Missing.Fingerprint;
        var laterSameSlot = Detect(commitment, [], new DateOnly(2026, 4, 25)).Missing.Fingerprint;

        Assert.Equal(first, laterSameSlot);
    }

    private CommitmentChangeDetection Detect(
        Commitment commitment,
        IEnumerable<Expense> expenses,
        DateOnly today) => Assert.Single(_detector.Detect(Owner, [commitment], expenses, today));

    private static Commitment Monthly(Guid? id = null)
    {
        var commitment = Base(id);
        commitment.Cadence = CommitmentCadence.Monthly;
        commitment.TimingKind = CommitmentTimingKind.DayOfMonth;
        commitment.ExpectedDay = 15;
        commitment.Occurrences = Confirmation(commitment, new DateOnly(2026, 2, 15));
        return commitment;
    }

    private static Commitment Weekly()
    {
        var commitment = Base();
        commitment.Cadence = CommitmentCadence.Weekly;
        commitment.TimingKind = CommitmentTimingKind.Weekday;
        commitment.ExpectedDayOfWeek = DayOfWeek.Monday;
        commitment.Occurrences = Confirmation(commitment, new DateOnly(2026, 2, 23));
        return commitment;
    }

    private static Commitment WeeklyWithLatestConfirmation(DateOnly latest)
    {
        var commitment = Weekly();
        commitment.Occurrences =
        [
            Link(Expense(1, latest.AddDays(-7), 10m)),
            Link(Expense(2, latest, 10m))
        ];
        return commitment;
    }

    private static Commitment Yearly()
    {
        var commitment = Base();
        commitment.Cadence = CommitmentCadence.Yearly;
        commitment.TimingKind = CommitmentTimingKind.MonthAndDay;
        commitment.ExpectedMonth = 2;
        commitment.ExpectedDay = 28;
        commitment.ExpectedAmount = 100m;
        commitment.Occurrences =
        [
            Link(Expense(1, new DateOnly(2025, 2, 28), 100m)),
            Link(Expense(2, new DateOnly(2026, 2, 28), 100m))
        ];
        return commitment;
    }

    private static Commitment Base(Guid? id = null) => new()
    {
        Id = id ?? Guid.Parse("10000000-0000-0000-0000-000000000001"),
        OwnerId = Owner,
        Name = "Gym club",
        Category = "health",
        Lifecycle = CommitmentLifecycle.Active,
        WindowBeforeDays = 0,
        WindowAfterDays = 0,
        AmountMode = CommitmentAmountMode.Fixed,
        ExpectedAmount = 10m,
        CreatedAt = new DateTime(2026, 2, 15, 0, 0, 0, DateTimeKind.Utc),
        UpdatedAt = new DateTime(2026, 2, 15, 0, 0, 0, DateTimeKind.Utc)
    };

    private static List<CommitmentOccurrence> Confirmation(Commitment commitment, DateOnly latest) =>
    [
        Link(Expense(1, latest.AddMonths(-1), commitment.ExpectedAmount ?? 10m)),
        Link(Expense(2, latest, commitment.ExpectedAmount ?? 10m))
    ];

    private static CommitmentOccurrence Link(Expense expense) => new()
    {
        ExpenseId = expense.Id,
        Expense = expense,
        Kind = CommitmentOccurrenceKind.ConfirmationEvidence
    };

    private static Expense Expense(
        int id,
        DateOnly date,
        decimal amount,
        string description = "gym club",
        string category = "health",
        string owner = Owner) => new()
        {
            Id = id,
            UserId = owner,
            Date = date,
            Amount = amount,
            Description = description,
            Category = category,
            CommitmentEvidenceRevision = Guid.Parse($"00000000-0000-0000-0000-{id:D12}")
        };
}
