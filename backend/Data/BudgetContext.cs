using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using BudgetPlanner.Models;

namespace BudgetPlanner.Data;

public class BudgetContext : IdentityDbContext<ApplicationUser>, IDataProtectionKeyContext
{
    public BudgetContext(DbContextOptions<BudgetContext> options) : base(options) {}

    public DbSet<Expense> Expenses { get; set; }
    public DbSet<BudgetLimit> BudgetLimits { get; set; }
    public DbSet<DataProtectionKey> DataProtectionKeys { get; set; }
    public DbSet<ImportPreviewBatch> ImportPreviewBatches { get; set; }
    public DbSet<ImportPreviewRow> ImportPreviewRows { get; set; }
    public DbSet<ImportExpenseProvenance> ImportExpenseProvenances { get; set; }
    public DbSet<Commitment> Commitments { get; set; }
    public DbSet<CommitmentOccurrence> CommitmentOccurrences { get; set; }
    public DbSet<CommitmentCandidateDismissal> CommitmentCandidateDismissals { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Expense>()
            .Property(e => e.Amount)
            .HasColumnType("numeric(18,2)");

        modelBuilder.Entity<Expense>()
            .Property(e => e.Date)
            .HasColumnType("date");

        modelBuilder.Entity<Expense>()
            .Property(e => e.CommitmentEvidenceRevision)
            .HasDefaultValueSql("gen_random_uuid()");

        modelBuilder.Entity<BudgetLimit>()
            .Property(b => b.LimitAmount)
            .HasColumnType("numeric(18,2)");

        modelBuilder.Entity<Expense>()
            .HasOne(e => e.User)
            .WithMany()
            .HasForeignKey(e => e.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ImportPreviewBatch>(batch =>
        {
            batch.ToTable(table =>
            {
                table.HasCheckConstraint("CK_ImportPreviewBatch_DigestLength", "octet_length(\"DocumentDigest\") = 32");
                table.HasCheckConstraint("CK_ImportPreviewBatch_Expiry", "\"ExpiresAt\" > \"CreatedAt\"");
                table.HasCheckConstraint("CK_ImportPreviewBatch_SourceType", "\"SourceType\" = 'sunflower_pdf'");
                table.HasCheckConstraint(
                    "CK_ImportPreviewBatch_ConfirmedAt",
                    "(\"Lifecycle\" = 'Confirmed' AND \"ConfirmedAt\" IS NOT NULL) OR " +
                    "(\"Lifecycle\" <> 'Confirmed' AND \"ConfirmedAt\" IS NULL)");
            });
            batch.Property(value => value.SourceType).HasMaxLength(50);
            batch.Property(value => value.ParserRuleVersion).HasMaxLength(100);
            batch.Property(value => value.DocumentDigest).HasColumnType("bytea").HasMaxLength(32);
            batch.Property(value => value.Lifecycle).HasConversion<string>().HasMaxLength(20);
            batch.HasOne(value => value.Owner).WithMany().HasForeignKey(value => value.OwnerId)
                .OnDelete(DeleteBehavior.Cascade);
            batch.HasIndex(value => new { value.OwnerId, value.SourceType, value.DocumentDigest })
                .IsUnique()
                .HasFilter("\"Lifecycle\" = 'Open'");
            batch.HasIndex(value => new
                {
                    value.OwnerId,
                    value.SourceType,
                    value.ParserRuleVersion,
                    value.DocumentDigest
                }, "IX_ImportPreviewBatches_ConfirmedDocument")
                .IsUnique()
                .HasDatabaseName("IX_ImportPreviewBatches_ConfirmedDocument")
                .HasFilter("\"Lifecycle\" = 'Confirmed'");
            batch.HasIndex(value => new
                {
                    value.OwnerId,
                    value.SourceType,
                    value.ParserRuleVersion,
                    value.DocumentDigest
                }, "IX_ImportPreviewBatches_ActiveDocument")
                .IsUnique()
                .HasDatabaseName("IX_ImportPreviewBatches_ActiveDocument")
                .HasFilter("\"Lifecycle\" IN ('Open', 'Confirmed')");
            batch.HasIndex(value => value.ExpiresAt);
        });

        modelBuilder.Entity<ImportPreviewRow>(row =>
        {
            row.ToTable(table => table.HasCheckConstraint(
                "CK_ImportPreviewRow_PositiveAmount", "\"Amount\" IS NULL OR \"Amount\" > 0"));
            row.Property(value => value.Amount).HasColumnType("numeric(18,2)");
            row.Property(value => value.PostedDate).HasColumnType("date");
            row.Property(value => value.Direction).HasConversion<string>().HasMaxLength(20);
            row.Property(value => value.SourceDescription).HasMaxLength(500);
            row.Property(value => value.SourceSection).HasMaxLength(100);
            row.Property(value => value.Classification).HasConversion<string>().HasMaxLength(30);
            row.Property(value => value.ValidationErrorCodes).HasColumnType("jsonb");
            row.Property(value => value.WarningCodes).HasColumnType("jsonb");
            row.Property(value => value.DuplicateExpenseIds).HasColumnType("jsonb");
            row.Property(value => value.EditableExpenseDescription).HasMaxLength(500);
            row.Property(value => value.Category).HasMaxLength(100);
            row.HasOne(value => value.Batch).WithMany(value => value.Rows).HasForeignKey(value => value.BatchId)
                .OnDelete(DeleteBehavior.Cascade);
            row.HasIndex(value => new { value.BatchId, value.SourceRowOrdinal }).IsUnique();
        });

        modelBuilder.Entity<ImportExpenseProvenance>(provenance =>
        {
            provenance.ToTable(table => table.HasCheckConstraint(
                "CK_ImportExpenseProvenance_PositiveSourceRowOrdinal",
                "\"SourceRowOrdinal\" > 0"));
            provenance.HasKey(value => new { value.BatchId, value.SourceRowOrdinal });
            provenance.HasOne(value => value.Batch)
                .WithMany(value => value.Provenance)
                .HasForeignKey(value => value.BatchId)
                .OnDelete(DeleteBehavior.Cascade);
            provenance.HasOne(value => value.Expense)
                .WithMany()
                .HasForeignKey(value => value.ExpenseId)
                .OnDelete(DeleteBehavior.SetNull);
            provenance.HasIndex(value => value.ExpenseId)
                .IsUnique()
                .HasFilter("\"ExpenseId\" IS NOT NULL");
        });

        modelBuilder.Entity<Commitment>(commitment =>
        {
            commitment.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_Commitment_Text",
                    "length(btrim(\"Name\")) > 0 AND length(btrim(\"Category\")) > 0");
                table.HasCheckConstraint(
                    "CK_Commitment_Enums",
                    "\"Lifecycle\" IN ('Active', 'Paused', 'Ended') AND " +
                    "\"Cadence\" IN ('Weekly', 'Monthly', 'Yearly') AND " +
                    "\"TimingKind\" IN ('Weekday', 'DayOfMonth', 'MonthEnd', 'MonthAndDay') AND " +
                    "\"AmountMode\" IN ('Fixed', 'Range')");
                table.HasCheckConstraint(
                    "CK_Commitment_Timing",
                    "(\"Cadence\" = 'Weekly' AND \"TimingKind\" = 'Weekday' AND \"ExpectedDayOfWeek\" IS NOT NULL AND \"ExpectedDayOfWeek\" IN ('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday') AND \"ExpectedDay\" IS NULL AND \"ExpectedMonth\" IS NULL) OR " +
                    "(\"Cadence\" = 'Monthly' AND \"TimingKind\" = 'DayOfMonth' AND \"ExpectedDayOfWeek\" IS NULL AND \"ExpectedDay\" IS NOT NULL AND \"ExpectedDay\" BETWEEN 1 AND 31 AND \"ExpectedMonth\" IS NULL) OR " +
                    "(\"Cadence\" = 'Monthly' AND \"TimingKind\" = 'MonthEnd' AND \"ExpectedDayOfWeek\" IS NULL AND \"ExpectedDay\" IS NULL AND \"ExpectedMonth\" IS NULL) OR " +
                    "(\"Cadence\" = 'Yearly' AND \"TimingKind\" = 'MonthAndDay' AND \"ExpectedDayOfWeek\" IS NULL AND \"ExpectedMonth\" IS NOT NULL AND \"ExpectedMonth\" BETWEEN 1 AND 12 AND \"ExpectedDay\" IS NOT NULL AND \"ExpectedDay\" BETWEEN 1 AND " +
                    "CASE WHEN \"ExpectedMonth\" = 2 THEN 29 WHEN \"ExpectedMonth\" IN (4, 6, 9, 11) THEN 30 ELSE 31 END)");
                table.HasCheckConstraint(
                    "CK_Commitment_Windows",
                    "\"WindowBeforeDays\" >= 0 AND \"WindowAfterDays\" >= 0");
                table.HasCheckConstraint(
                    "CK_Commitment_Amount",
                    "(\"AmountMode\" = 'Fixed' AND \"ExpectedAmount\" IS NOT NULL AND \"ExpectedAmount\" > 0 AND \"ExpectedMinimumAmount\" IS NULL AND \"ExpectedMaximumAmount\" IS NULL) OR " +
                    "(\"AmountMode\" = 'Range' AND \"ExpectedAmount\" IS NULL AND \"ExpectedMinimumAmount\" IS NOT NULL AND \"ExpectedMinimumAmount\" > 0 AND \"ExpectedMaximumAmount\" IS NOT NULL AND \"ExpectedMaximumAmount\" >= \"ExpectedMinimumAmount\")");
                table.HasCheckConstraint(
                    "CK_Commitment_Origin",
                    "(\"OriginAlgorithmVersion\" IS NULL AND \"OriginEvidenceFingerprint\" IS NULL) OR " +
                    "(\"OriginAlgorithmVersion\" IS NOT NULL AND length(btrim(\"OriginAlgorithmVersion\")) > 0 AND \"OriginEvidenceFingerprint\" IS NOT NULL AND octet_length(\"OriginEvidenceFingerprint\") = 32)");
                table.HasCheckConstraint(
                    "CK_Commitment_Timestamps",
                    "\"UpdatedAt\" >= \"CreatedAt\"");
            });
            commitment.Property(value => value.Name).HasMaxLength(500);
            commitment.Property(value => value.Category).HasMaxLength(100);
            commitment.Property(value => value.Lifecycle).HasConversion<string>().HasMaxLength(20);
            commitment.Property(value => value.Cadence).HasConversion<string>().HasMaxLength(20);
            commitment.Property(value => value.TimingKind).HasConversion<string>().HasMaxLength(30);
            commitment.Property(value => value.ExpectedDayOfWeek).HasConversion<string>().HasMaxLength(20);
            commitment.Property(value => value.AmountMode).HasConversion<string>().HasMaxLength(20);
            commitment.Property(value => value.ExpectedAmount).HasColumnType("numeric(18,2)");
            commitment.Property(value => value.ExpectedMinimumAmount).HasColumnType("numeric(18,2)");
            commitment.Property(value => value.ExpectedMaximumAmount).HasColumnType("numeric(18,2)");
            commitment.Property(value => value.OriginAlgorithmVersion).HasMaxLength(100);
            commitment.Property(value => value.OriginEvidenceFingerprint).HasColumnType("bytea").HasMaxLength(32);
            commitment.HasOne(value => value.Owner).WithMany().HasForeignKey(value => value.OwnerId)
                .OnDelete(DeleteBehavior.Cascade);
            commitment.HasIndex(value => new { value.OwnerId, value.OriginEvidenceFingerprint })
                .IsUnique()
                .HasDatabaseName("UX_Commitments_Owner_OriginFingerprint")
                .HasFilter("\"OriginEvidenceFingerprint\" IS NOT NULL");
        });

        modelBuilder.Entity<CommitmentOccurrence>(occurrence =>
        {
            occurrence.ToTable(table => table.HasCheckConstraint(
                "CK_CommitmentOccurrence_Kind",
                "\"Kind\" = 'ConfirmationEvidence'"));
            occurrence.HasKey(value => new { value.CommitmentId, value.ExpenseId });
            occurrence.Property(value => value.Kind).HasConversion<string>().HasMaxLength(30);
            occurrence.HasOne(value => value.Commitment).WithMany(value => value.Occurrences)
                .HasForeignKey(value => value.CommitmentId).OnDelete(DeleteBehavior.Cascade);
            occurrence.HasOne(value => value.Expense).WithMany()
                .HasForeignKey(value => value.ExpenseId).OnDelete(DeleteBehavior.Cascade);
            occurrence.HasIndex(value => value.ExpenseId).IsUnique();
        });

        modelBuilder.Entity<CommitmentCandidateDismissal>(dismissal =>
        {
            dismissal.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_CommitmentCandidateDismissal_FingerprintLength",
                    "octet_length(\"EvidenceFingerprint\") = 32");
                table.HasCheckConstraint(
                    "CK_CommitmentCandidateDismissal_Cadence",
                    "\"Cadence\" IN ('Weekly', 'Monthly', 'Yearly')");
                table.HasCheckConstraint(
                    "CK_CommitmentCandidateDismissal_AlgorithmVersion",
                    "length(btrim(\"AlgorithmVersion\")) > 0");
            });
            dismissal.Property(value => value.AlgorithmVersion).HasMaxLength(100);
            dismissal.Property(value => value.Cadence).HasConversion<string>().HasMaxLength(20);
            dismissal.Property(value => value.EvidenceFingerprint).HasColumnType("bytea").HasMaxLength(32);
            dismissal.HasOne(value => value.Owner).WithMany().HasForeignKey(value => value.OwnerId)
                .OnDelete(DeleteBehavior.Cascade);
            dismissal.HasIndex(value => new
            {
                value.OwnerId,
                value.AlgorithmVersion,
                value.Cadence,
                value.EvidenceFingerprint
            }).IsUnique().HasDatabaseName("UX_CandidateDismissals_Owner_Origin");
        });

        modelBuilder.Entity<BudgetLimit>()
            .HasOne(b => b.User)
            .WithMany()
            .HasForeignKey(b => b.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
