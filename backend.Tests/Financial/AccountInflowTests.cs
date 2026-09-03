using BudgetPlanner.Models;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

public sealed class AccountInflowTests
{
    [Fact]
    public void New_inflows_receive_distinct_nonempty_evidence_revisions()
    {
        var first = new AccountInflow();
        var second = new AccountInflow();

        Assert.NotEqual(Guid.Empty, first.PaycheckEvidenceRevision);
        Assert.NotEqual(Guid.Empty, second.PaycheckEvidenceRevision);
        Assert.NotEqual(first.PaycheckEvidenceRevision, second.PaycheckEvidenceRevision);
    }

    [Fact]
    public void UpdateEvidence_preserves_revision_for_equivalent_description_formatting()
    {
        var inflow = Inflow();
        var revision = inflow.PaycheckEvidenceRevision;

        var changed = inflow.UpdateEvidence(
            "  weekly\tpayroll  ",
            inflow.Amount,
            inflow.Date);

        Assert.False(changed);
        Assert.Equal(revision, inflow.PaycheckEvidenceRevision);
        Assert.Equal("weekly\tpayroll", inflow.Description);
    }

    [Fact]
    public void Shared_identity_normalization_matches_update_evidence_materiality()
    {
        Assert.Equal(
            "weekly payroll",
            AccountInflowIdentity.NormalizeDescription("  WEEKLY\t\n PAYROLL  "));

        var inflow = Inflow();
        var revision = inflow.PaycheckEvidenceRevision;
        Assert.False(inflow.UpdateEvidence("\nweekly\tpayroll ", inflow.Amount, inflow.Date));
        Assert.Equal(revision, inflow.PaycheckEvidenceRevision);
    }

    [Fact]
    public void UpdateEvidence_rotates_revision_for_each_material_evidence_change()
    {
        var inflow = Inflow();
        var originalRevision = inflow.PaycheckEvidenceRevision;

        Assert.True(inflow.UpdateEvidence("Different payroll", inflow.Amount, inflow.Date));
        var descriptionRevision = inflow.PaycheckEvidenceRevision;
        Assert.NotEqual(originalRevision, descriptionRevision);

        Assert.True(inflow.UpdateEvidence(inflow.Description, inflow.Amount + 1m, inflow.Date));
        var amountRevision = inflow.PaycheckEvidenceRevision;
        Assert.NotEqual(descriptionRevision, amountRevision);

        Assert.True(inflow.UpdateEvidence(inflow.Description, inflow.Amount, inflow.Date.AddDays(1)));
        Assert.NotEqual(amountRevision, inflow.PaycheckEvidenceRevision);
    }

    private static AccountInflow Inflow() => new()
    {
        Description = "Weekly   Payroll",
        Amount = 1250.25m,
        Date = new DateOnly(2026, 9, 1)
    };
}
