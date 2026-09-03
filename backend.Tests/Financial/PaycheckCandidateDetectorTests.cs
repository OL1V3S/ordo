using System.Globalization;
using BudgetPlanner.Models;
using BudgetPlanner.Paychecks;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

public sealed class PaycheckCandidateDetectorTests
{
    private static readonly DateOnly EvaluatedOn = new(2026, 9, 3);
    private readonly PaycheckCandidateDetector detector = new();

    [Fact]
    public void Weekly_requires_six_consecutive_slots_and_preserves_phase_and_windows()
    {
        var anchors = Dates(new(2026, 7, 3), 7, 6);
        var offsets = new[] { -3, -2, 0, 0, 2, 3 };
        var six = anchors.Select((anchor, index) => Inflow(index + 1, anchor.AddDays(offsets[index]))).ToArray();

        Assert.Empty(detector.Detect(six[..5], EvaluatedOn));
        var candidate = Assert.Single(detector.Detect(six, EvaluatedOn));

        var schedule = Assert.IsType<WeeklyPaycheckSchedule>(candidate.Schedule);
        Assert.Equal(anchors[0], schedule.ReferenceAnchor);
        Assert.Equal(3, candidate.WindowBeforeDays);
        Assert.Equal(3, candidate.WindowAfterDays);
        Assert.Equal(offsets, candidate.Evidence.Select(value => value.TimingOffsetDays));
    }

    [Fact]
    public void Weekly_rejects_four_day_offsets_and_handles_year_boundaries()
    {
        var dates = Dates(new(2025, 12, 12), 7, 6);
        var valid = dates.Select((date, index) => Inflow(index + 1, date)).ToArray();
        Assert.IsType<WeeklyPaycheckSchedule>(Assert.Single(detector.Detect(valid, new(2026, 1, 31))).Schedule);

        valid[0].Date = valid[0].Date.AddDays(-3);
        valid[^1].Date = valid[^1].Date.AddDays(4);
        Assert.Empty(detector.Detect(valid, new(2026, 1, 31)));
    }

    [Fact]
    public void Biweekly_requires_four_slots_spanning_42_days_and_preserves_alternating_week_phase()
    {
        var four = Dates(new(2026, 6, 5), 14, 4)
            .Select((date, index) => Inflow(index + 1, date))
            .ToArray();

        Assert.Empty(detector.Detect(four[..3], EvaluatedOn));
        var candidate = Assert.Single(detector.Detect(four, EvaluatedOn));

        var schedule = Assert.IsType<BiweeklyPaycheckSchedule>(candidate.Schedule);
        Assert.Equal(four[0].Date, schedule.ReferenceAnchor);
        Assert.All(candidate.Evidence.Zip(candidate.Evidence.Skip(1)), pair =>
            Assert.Equal(14, pair.Second.SlotAnchor.DayNumber - pair.First.SlotAnchor.DayNumber));
    }

    [Fact]
    public void Monthly_requires_consecutive_months_and_uses_canonical_month_end_across_leap_february()
    {
        var monthEnd = new[]
        {
            Inflow(1, new(2024, 1, 31)),
            Inflow(2, new(2024, 2, 29)),
            Inflow(3, new(2024, 3, 31))
        };
        var candidate = Assert.Single(detector.Detect(monthEnd, new(2024, 4, 1)));
        var schedule = Assert.IsType<MonthlyPaycheckSchedule>(candidate.Schedule);
        Assert.Equal(PaycheckMonthAnchor.MonthEnd, schedule.Anchor);

        monthEnd[1].Date = new DateOnly(2023, 2, 28);
        Assert.Empty(detector.Detect(monthEnd, new(2024, 4, 1)));
    }

    [Fact]
    public void Monthly_day_anchor_clamps_in_short_months_and_day_31_canonicalizes_to_month_end()
    {
        var candidate = Assert.Single(detector.Detect(
        [
            Inflow(1, new(2025, 1, 30)),
            Inflow(2, new(2025, 2, 28)),
            Inflow(3, new(2025, 3, 30))
        ], new(2025, 4, 1)));

        Assert.Equal(PaycheckMonthAnchor.DayOfMonth(30), Assert.IsType<MonthlyPaycheckSchedule>(candidate.Schedule).Anchor);
        Assert.Equal(PaycheckMonthAnchor.MonthEnd, PaycheckMonthAnchor.DayOfMonth(31));
    }

    [Fact]
    public void Semimonthly_requires_six_alternating_slots_across_three_months()
    {
        var six = new[]
        {
            Inflow(1, new(2026, 1, 15)), Inflow(2, new(2026, 1, 31)),
            Inflow(3, new(2026, 2, 15)), Inflow(4, new(2026, 2, 28)),
            Inflow(5, new(2026, 3, 15)), Inflow(6, new(2026, 3, 31))
        };

        Assert.DoesNotContain(
            detector.Detect(six[..5], new(2026, 4, 1)),
            candidate => candidate.Schedule is SemimonthlyPaycheckSchedule);
        var schedule = Assert.IsType<SemimonthlyPaycheckSchedule>(
            Assert.Single(detector.Detect(six, new(2026, 4, 1))).Schedule);
        Assert.Equal(PaycheckMonthAnchor.DayOfMonth(15), schedule.First);
        Assert.Equal(PaycheckMonthAnchor.MonthEnd, schedule.Second);
    }

    [Fact]
    public void Semimonthly_handles_adjacent_month_early_posting_and_is_not_a_fifteen_day_interval()
    {
        var evidence = new[]
        {
            Inflow(1, new(2026, 1, 15)), Inflow(2, new(2026, 1, 29)),
            Inflow(3, new(2026, 2, 13)), Inflow(4, new(2026, 2, 26)),
            Inflow(5, new(2026, 3, 13)), Inflow(6, new(2026, 3, 29))
        };

        var candidate = Assert.Single(detector.Detect(evidence, new(2026, 4, 1)));
        Assert.IsType<SemimonthlyPaycheckSchedule>(candidate.Schedule);
        Assert.Equal(2, candidate.WindowBeforeDays);
        Assert.Contains(candidate.Evidence.Zip(candidate.Evidence.Skip(1)), pair =>
            pair.Second.SlotAnchor.DayNumber - pair.First.SlotAnchor.DayNumber != 15);
    }

    [Fact]
    public void Semimonthly_supports_day_day_anchors_and_leap_february_day_month_end_anchors()
    {
        var dayDay = new[]
        {
            Inflow(1, new(2026, 1, 5)), Inflow(2, new(2026, 1, 20)),
            Inflow(3, new(2026, 2, 5)), Inflow(4, new(2026, 2, 20)),
            Inflow(5, new(2026, 3, 5)), Inflow(6, new(2026, 3, 20))
        };
        var dayDaySchedule = Assert.IsType<SemimonthlyPaycheckSchedule>(
            Assert.Single(detector.Detect(dayDay, new(2026, 3, 25))).Schedule);
        Assert.Equal(PaycheckMonthAnchor.DayOfMonth(5), dayDaySchedule.First);
        Assert.Equal(PaycheckMonthAnchor.DayOfMonth(20), dayDaySchedule.Second);

        var leap = new[]
        {
            Inflow(11, new(2023, 12, 10)), Inflow(12, new(2023, 12, 31)),
            Inflow(13, new(2024, 1, 10)), Inflow(14, new(2024, 1, 31)),
            Inflow(15, new(2024, 2, 10)), Inflow(16, new(2024, 2, 29))
        };
        var leapSchedule = Assert.IsType<SemimonthlyPaycheckSchedule>(
            Assert.Single(detector.Detect(leap, new(2024, 3, 1))).Schedule);
        Assert.Equal(PaycheckMonthAnchor.DayOfMonth(10), leapSchedule.First);
        Assert.Equal(PaycheckMonthAnchor.MonthEnd, leapSchedule.Second);
    }

    [Fact]
    public void Semimonthly_rejects_pairs_that_can_collapse_or_be_less_than_seven_days_apart()
    {
        Assert.Throws<ArgumentException>(() => new SemimonthlyPaycheckSchedule(
            PaycheckMonthAnchor.DayOfMonth(25), PaycheckMonthAnchor.MonthEnd));
        Assert.Throws<ArgumentException>(() => new SemimonthlyPaycheckSchedule(
            PaycheckMonthAnchor.DayOfMonth(30), PaycheckMonthAnchor.MonthEnd));
        Assert.Throws<ArgumentException>(() => new SemimonthlyPaycheckSchedule(
            PaycheckMonthAnchor.DayOfMonth(15), PaycheckMonthAnchor.DayOfMonth(10)));
    }

    [Fact]
    public void Normalization_groups_case_and_dotnet_whitespace_but_preserves_meaningful_text_distinctions()
    {
        var payroll = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date, description: index switch
            {
                0 => "  ACME   PAYROLL ",
                1 => "acme\tpayroll",
                2 => "Acme\npayroll",
                _ => "acme payroll"
            }))
            .ToList();
        payroll.AddRange(Dates(new(2026, 7, 4), 7, 6)
            .Select((date, index) => Inflow(20 + index, date, description: "acme payroll bonus")));

        var candidates = detector.Detect(payroll, EvaluatedOn);

        Assert.Equal(new[] { "acme payroll", "acme payroll bonus" },
            candidates.Select(value => value.NormalizedDescriptionIdentity));
    }

    [Fact]
    public void Source_navigation_state_and_raw_formatting_do_not_affect_identity_or_fingerprint()
    {
        var first = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date, description: "Payroll Source"))
            .ToArray();
        var second = first.Select(value => new AccountInflow
        {
            Id = value.Id,
            OwnerId = value.OwnerId,
            Description = value.Id % 2 == 0 ? " payroll\tsource " : "PAYROLL   SOURCE",
            Amount = value.Amount,
            Date = value.Date,
            PaycheckEvidenceRevision = value.PaycheckEvidenceRevision,
            Owner = new ApplicationUser()
        }).ToArray();

        Assert.Equal(
            Assert.Single(detector.Detect(first, EvaluatedOn)).EvidenceFingerprint,
            Assert.Single(detector.Detect(second, EvaluatedOn)).EvidenceFingerprint);
    }

    [Fact]
    public void Mixed_or_blank_owners_fail_closed_for_the_whole_invocation()
    {
        var evidence = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date))
            .ToArray();
        evidence[^1].OwnerId = "other-owner";
        Assert.Empty(detector.Detect(evidence, EvaluatedOn));

        evidence[^1].OwnerId = " ";
        Assert.Empty(detector.Detect(evidence, EvaluatedOn));
    }

    [Fact]
    public void Duplicate_ids_empty_revisions_and_invalid_financial_fields_withhold_only_affected_identity()
    {
        var invalid = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date, description: "invalid payroll"))
            .ToList();
        invalid[0].PaycheckEvidenceRevision = Guid.Empty;
        invalid[1].Amount = 0m;
        invalid[2].Amount = 10.001m;
        invalid.Add(Inflow(4, new(2026, 8, 20), description: "invalid payroll"));
        var valid = Dates(new(2026, 7, 4), 7, 6)
            .Select((date, index) => Inflow(20 + index, date, description: "valid payroll"));

        var candidate = Assert.Single(detector.Detect(invalid.Concat(valid), EvaluatedOn));
        Assert.Equal("valid payroll", candidate.NormalizedDescriptionIdentity);
    }

    [Fact]
    public void Horizon_is_eighteen_calendar_months_inclusive_and_future_rows_are_ignored()
    {
        var evaluatedOn = new DateOnly(2026, 9, 3);
        var horizonStart = new DateOnly(2025, 4, 1);
        var evidence = new[]
        {
            Inflow(1, horizonStart),
            Inflow(2, new(2025, 5, 1)),
            Inflow(3, new(2025, 6, 1)),
            Inflow(4, horizonStart.AddDays(-1)),
            Inflow(5, evaluatedOn.AddDays(1))
        };

        var candidate = Assert.Single(detector.Detect(evidence, evaluatedOn));
        Assert.Equal(new[] { 1, 2, 3 }, candidate.Evidence.Select(value => value.AccountInflowId));
    }

    [Fact]
    public void Out_of_horizon_rows_do_not_participate_in_owner_validation()
    {
        var current = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date));
        var oldOtherOwner = Inflow(20, new(2025, 3, 31), ownerId: "other-owner");

        Assert.Single(detector.Detect(current.Append(oldOtherOwner), EvaluatedOn));
    }

    [Fact]
    public void Extra_observation_between_biweekly_slots_is_a_barrier_and_is_not_silently_dropped()
    {
        var anchors = Dates(new(2026, 6, 5), 14, 4);
        var evidence = anchors.Select((date, index) => Inflow(index + 1, date)).ToList();
        evidence.Add(Inflow(20, anchors[1].AddDays(7)));

        Assert.Empty(detector.Detect(evidence, EvaluatedOn));
    }

    [Fact]
    public void Multiple_observations_in_one_slot_break_the_run_but_a_newer_qualifying_run_can_win()
    {
        var old = Dates(new(2026, 5, 1), 7, 3)
            .Select((date, index) => Inflow(index + 1, date))
            .ToList();
        old.Add(Inflow(10, old[1].Date));
        var recent = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(20 + index, date))
            .ToArray();

        var candidate = Assert.Single(detector.Detect(old.Concat(recent), EvaluatedOn));
        Assert.Equal(recent.Select(value => value.Id), candidate.Evidence.Select(value => value.AccountInflowId));
    }

    [Fact]
    public void Most_recent_qualifying_maximal_run_wins_over_an_older_longer_run()
    {
        var older = Dates(new(2026, 3, 6), 7, 8)
            .Select((date, index) => Inflow(index + 1, date, amount: 1000m))
            .ToArray();
        var newer = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(20 + index, date, amount: 1200m))
            .ToArray();

        var candidate = Assert.Single(detector.Detect(older.Concat(newer), EvaluatedOn));

        Assert.Equal(newer.Select(value => value.Id), candidate.Evidence.Select(value => value.AccountInflowId));
        Assert.Equal(1200m, Assert.IsType<FixedObservedPaycheckAmount>(candidate.ObservedAmount).Amount);
    }

    [Fact]
    public void Equal_rank_distinct_monthly_rules_fail_closed_instead_of_using_enumeration_order()
    {
        var evidence = new[]
        {
            Inflow(1, new(2026, 4, 14)),
            Inflow(2, new(2026, 5, 15)),
            Inflow(3, new(2026, 6, 14)),
            Inflow(4, new(2026, 7, 15))
        };

        Assert.Empty(detector.Detect(evidence, new(2026, 8, 1)));
    }

    [Fact]
    public void Exact_anchor_minimizes_total_offset_before_a_shifted_timing_rule()
    {
        var evidence = new[]
        {
            Inflow(1, new(2026, 4, 10)),
            Inflow(2, new(2026, 5, 10)),
            Inflow(3, new(2026, 6, 10))
        };

        var schedule = Assert.IsType<MonthlyPaycheckSchedule>(
            Assert.Single(detector.Detect(evidence, new(2026, 7, 1))).Schedule);
        Assert.Equal(PaycheckMonthAnchor.DayOfMonth(10), schedule.Anchor);
    }

    [Fact]
    public void Longer_equal_end_run_wins_before_total_offset_score()
    {
        var anchors = Dates(new(2026, 6, 5), 7, 7);
        var evidence = anchors.Select((anchor, index) =>
            Inflow(index + 1, anchor.AddDays(index == 0 ? -3 : 1))).ToArray();

        var candidate = Assert.Single(detector.Detect(evidence, EvaluatedOn));

        Assert.Equal(7, candidate.Evidence.Count);
        Assert.Equal(anchors[0], Assert.IsType<WeeklyPaycheckSchedule>(candidate.Schedule).ReferenceAnchor);
    }

    [Fact]
    public void Equal_rank_biweekly_and_semimonthly_cadence_fits_are_withheld()
    {
        var evidence = new[]
        {
            Inflow(1, new(2026, 1, 1)), Inflow(2, new(2026, 1, 15)),
            Inflow(3, new(2026, 1, 29)), Inflow(4, new(2026, 2, 12)),
            Inflow(5, new(2026, 3, 1)), Inflow(6, new(2026, 3, 15))
        };

        Assert.Empty(detector.Detect(evidence, new(2026, 3, 20)));
    }

    [Fact]
    public void Duplicate_same_slot_observation_withholds_an_otherwise_supported_run()
    {
        var evidence = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date))
            .Append(Inflow(20, new(2026, 7, 17)))
            .ToArray();

        Assert.Empty(detector.Detect(evidence, EvaluatedOn));
    }

    [Fact]
    public void Amount_summary_is_fixed_or_uses_raw_minimum_lower_median_and_maximum()
    {
        var fixedCandidate = Assert.Single(detector.Detect(
            Dates(new(2026, 7, 3), 7, 6).Select((date, index) => Inflow(index + 1, date, 1000m)),
            EvaluatedOn));
        Assert.Equal(1000m, Assert.IsType<FixedObservedPaycheckAmount>(fixedCandidate.ObservedAmount).Amount);

        var amounts = new[] { 1400m, 1000m, 1300m, 1100m, 1500m, 1200m };
        var variableCandidate = Assert.Single(detector.Detect(
            Dates(new(2026, 7, 3), 7, 6).Select((date, index) => Inflow(index + 1, date, amounts[index])),
            EvaluatedOn));
        var variable = Assert.IsType<VariableObservedPaycheckAmount>(variableCandidate.ObservedAmount);
        Assert.Equal(1000m, variable.Minimum);
        Assert.Equal(1200m, variable.LowerMedian);
        Assert.Equal(1500m, variable.Maximum);
    }

    [Fact]
    public void Candidate_and_evidence_order_and_fingerprint_are_stable_across_input_and_culture()
    {
        var alpha = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date, description: "Alpha Payroll"));
        var zeta = Dates(new(2026, 7, 4), 7, 6)
            .Select((date, index) => Inflow(20 + index, date, description: "Zeta Payroll"));
        var input = alpha.Concat(zeta).ToArray();
        var originalCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
            var first = detector.Detect(input, EvaluatedOn);
            CultureInfo.CurrentCulture = new CultureInfo("en-US");
            var second = detector.Detect(input.Reverse(), EvaluatedOn);

            Assert.Equal(new[] { "alpha payroll", "zeta payroll" }, first.Select(value => value.NormalizedDescriptionIdentity));
            Assert.Equal(first.Select(value => value.EvidenceFingerprint), second.Select(value => value.EvidenceFingerprint));
            Assert.All(second, candidate => Assert.Equal(
                candidate.Evidence.OrderBy(value => value.PostedDate).ThenBy(value => value.AccountInflowId),
                candidate.Evidence));
        }
        finally
        {
            CultureInfo.CurrentCulture = originalCulture;
        }
    }

    [Fact]
    public void Candidate_evidence_is_an_immutable_snapshot_of_mutable_persistence_objects()
    {
        var evidence = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date))
            .ToArray();
        var candidate = Assert.Single(detector.Detect(evidence, EvaluatedOn));
        var captured = candidate.Evidence[0];

        evidence[0].Description = "mutated";
        evidence[0].Amount = 42m;
        evidence[0].Date = evidence[0].Date.AddDays(2);
        evidence[0].PaycheckEvidenceRevision = Guid.NewGuid();

        Assert.Equal("Payroll", captured.Description);
        Assert.Equal(1000m, captured.Amount);
        Assert.Equal(new DateOnly(2026, 7, 3), captured.PostedDate);
        Assert.Equal(Revision(1), captured.PaycheckEvidenceRevision);
    }

    [Fact]
    public void Fingerprint_is_lowercase_sha256_and_changes_with_id_or_revision()
    {
        var evidence = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date))
            .ToArray();
        var original = Assert.Single(detector.Detect(evidence, EvaluatedOn)).EvidenceFingerprint;
        Assert.Matches("^[0-9a-f]{64}$", original);

        evidence[^1].PaycheckEvidenceRevision = Revision(99);
        var revised = Assert.Single(detector.Detect(evidence, EvaluatedOn)).EvidenceFingerprint;
        Assert.NotEqual(original, revised);

        evidence[^1].Id = 99;
        var renumbered = Assert.Single(detector.Detect(evidence, EvaluatedOn)).EvidenceFingerprint;
        Assert.NotEqual(revised, renumbered);
    }

    [Fact]
    public void Fingerprint_changes_with_semantic_identity_timing_windows_and_evidence_membership()
    {
        var evidence = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date))
            .ToArray();
        var original = Assert.Single(detector.Detect(evidence, EvaluatedOn)).EvidenceFingerprint;

        var renamed = evidence.Select(Clone).ToArray();
        foreach (var inflow in renamed) inflow.Description = "Other Payroll";
        Assert.NotEqual(original, Assert.Single(detector.Detect(renamed, EvaluatedOn)).EvidenceFingerprint);

        var windowed = evidence.Select(Clone).ToArray();
        windowed[0].Date = windowed[0].Date.AddDays(-1);
        windowed[^1].Date = windowed[^1].Date.AddDays(1);
        Assert.NotEqual(original, Assert.Single(detector.Detect(windowed, EvaluatedOn)).EvidenceFingerprint);

        var shifted = evidence.Select(Clone).ToArray();
        foreach (var inflow in shifted) inflow.Date = inflow.Date.AddDays(1);
        Assert.NotEqual(original, Assert.Single(detector.Detect(shifted, EvaluatedOn)).EvidenceFingerprint);

        var extended = evidence.Append(Inflow(20, new(2026, 8, 14))).ToArray();
        Assert.NotEqual(original, Assert.Single(detector.Detect(extended, EvaluatedOn)).EvidenceFingerprint);
    }

    [Fact]
    public void Fingerprint_has_locked_v1_golden_vector()
    {
        var evidence = Dates(new(2026, 7, 3), 7, 6)
            .Select((date, index) => Inflow(index + 1, date, 1000m, "Golden Payroll"))
            .ToArray();

        Assert.Equal(
            "95e69386cfddd380b1641b5c54eb06f46510f21f1c0170a378dcf9bd1bbdff58",
            Assert.Single(detector.Detect(evidence, EvaluatedOn)).EvidenceFingerprint);
    }

    [Fact]
    public void Public_candidate_contract_does_not_claim_unapproved_payroll_semantics()
    {
        var propertyNames = typeof(PaycheckCandidate).GetProperties().Select(property => property.Name).ToHashSet();
        var prohibited = new[] { "GrossPay", "Tax", "Deduction", "IncomeClassification", "Confidence", "Bonus", "Commission", "Guarantee" };
        Assert.DoesNotContain(prohibited, propertyNames.Contains);
    }

    private static DateOnly[] Dates(DateOnly first, int intervalDays, int count) =>
        Enumerable.Range(0, count).Select(index => first.AddDays(index * intervalDays)).ToArray();

    private static AccountInflow Inflow(
        int id,
        DateOnly date,
        decimal amount = 1000m,
        string description = "Payroll",
        string ownerId = "owner") => new()
        {
            Id = id,
            OwnerId = ownerId,
            Description = description,
            Amount = amount,
            Date = date,
            PaycheckEvidenceRevision = Revision(id)
        };

    private static AccountInflow Clone(AccountInflow value) => new()
    {
        Id = value.Id,
        OwnerId = value.OwnerId,
        Description = value.Description,
        Amount = value.Amount,
        Date = value.Date,
        PaycheckEvidenceRevision = value.PaycheckEvidenceRevision
    };

    private static Guid Revision(int id) => Guid.Parse($"00000000-0000-0000-0000-{id:000000000000}");
}
