using System.Data;
using BudgetPlanner.Commitments;
using BudgetPlanner.Contracts.Commitments;
using BudgetPlanner.Contracts.Home;
using Microsoft.EntityFrameworkCore;
using BudgetPlanner.Data;

namespace BudgetPlanner.Home;

public sealed class HomeAttentionReader(
    BudgetContext context,
    ICommitmentChangeReadService changes) : IHomeAttentionReader
{
    public async Task<HomeAttentionSectionResponse> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken)
    {
        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken)
            : null;
        if (context.Database.IsNpgsql())
            await context.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", cancellationToken);

        var response = await changes.EvaluateChangesAsync(ownerId, evaluatedOn, cancellationToken);
        var items = response.Changes
            .Select(change => new HomeAttentionItemResponse(
                "commitment_change_review",
                change.Commitment.Id,
                change.Commitment.Name,
                PendingReviews(change)))
            .Where(item => item.Reviews.Count > 0)
            .ToArray();

        if (transaction is not null)
            await transaction.CommitAsync(cancellationToken);

        return new HomeAttentionSectionResponse(
            new HomeSectionAvailabilityResponse("available", null),
            ["commitment_change_review"],
            items,
            evaluatedOn);
    }

    private static IReadOnlyList<HomeCommitmentReviewResponse> PendingReviews(
        CommitmentChangeResponse change)
    {
        var reviews = new List<HomeCommitmentReviewResponse>(3);
        AddIfPending(reviews, "amount", change.Amount.State, change.Amount.Fingerprint,
            change.Amount.DecisionState, change.Amount.State == "proposed_change");
        AddIfPending(reviews, "timing", change.Timing.State, change.Timing.Fingerprint,
            change.Timing.DecisionState, change.Timing.State == "proposed_change");
        AddIfPending(reviews, "missing", change.Missing.State, change.Missing.Fingerprint,
            change.Missing.DecisionState,
            change.Missing.State is "not_seen_recently" or "possibly_ended");
        return reviews;
    }

    private static void AddIfPending(
        ICollection<HomeCommitmentReviewResponse> reviews,
        string dimension,
        string state,
        string? fingerprint,
        string? decisionState,
        bool actionableState)
    {
        if (actionableState && fingerprint is not null && decisionState == "pending")
            reviews.Add(new HomeCommitmentReviewResponse(dimension, state));
    }
}
