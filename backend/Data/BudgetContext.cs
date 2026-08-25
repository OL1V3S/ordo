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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Expense>()
            .Property(e => e.Amount)
            .HasColumnType("numeric(18,2)");

        modelBuilder.Entity<Expense>()
            .Property(e => e.Date)
            .HasColumnType("date");

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

        modelBuilder.Entity<BudgetLimit>()
            .HasOne(b => b.User)
            .WithMany()
            .HasForeignKey(b => b.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
