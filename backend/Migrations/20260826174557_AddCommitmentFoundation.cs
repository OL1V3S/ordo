using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddCommitmentFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CommitmentEvidenceRevision",
                table: "Expenses",
                type: "uuid",
                nullable: false,
                defaultValueSql: "gen_random_uuid()");

            migrationBuilder.CreateTable(
                name: "CommitmentCandidateDismissals",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    AlgorithmVersion = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Cadence = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EvidenceFingerprint = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: false),
                    DismissedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommitmentCandidateDismissals", x => x.Id);
                    table.CheckConstraint("CK_CommitmentCandidateDismissal_AlgorithmVersion", "length(btrim(\"AlgorithmVersion\")) > 0");
                    table.CheckConstraint("CK_CommitmentCandidateDismissal_Cadence", "\"Cadence\" IN ('Weekly', 'Monthly', 'Yearly')");
                    table.CheckConstraint("CK_CommitmentCandidateDismissal_FingerprintLength", "octet_length(\"EvidenceFingerprint\") = 32");
                    table.ForeignKey(
                        name: "FK_CommitmentCandidateDismissals_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Commitments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Lifecycle = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Cadence = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    TimingKind = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ExpectedDayOfWeek = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    ExpectedDay = table.Column<int>(type: "integer", nullable: true),
                    ExpectedMonth = table.Column<int>(type: "integer", nullable: true),
                    WindowBeforeDays = table.Column<int>(type: "integer", nullable: false),
                    WindowAfterDays = table.Column<int>(type: "integer", nullable: false),
                    AmountMode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ExpectedAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    ExpectedMinimumAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    ExpectedMaximumAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    OriginAlgorithmVersion = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    OriginEvidenceFingerprint = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Commitments", x => x.Id);
                    table.CheckConstraint("CK_Commitment_Amount", "(\"AmountMode\" = 'Fixed' AND \"ExpectedAmount\" IS NOT NULL AND \"ExpectedAmount\" > 0 AND \"ExpectedMinimumAmount\" IS NULL AND \"ExpectedMaximumAmount\" IS NULL) OR (\"AmountMode\" = 'Range' AND \"ExpectedAmount\" IS NULL AND \"ExpectedMinimumAmount\" IS NOT NULL AND \"ExpectedMinimumAmount\" > 0 AND \"ExpectedMaximumAmount\" IS NOT NULL AND \"ExpectedMaximumAmount\" >= \"ExpectedMinimumAmount\")");
                    table.CheckConstraint("CK_Commitment_Enums", "\"Lifecycle\" IN ('Active', 'Paused', 'Ended') AND \"Cadence\" IN ('Weekly', 'Monthly', 'Yearly') AND \"TimingKind\" IN ('Weekday', 'DayOfMonth', 'MonthEnd', 'MonthAndDay') AND \"AmountMode\" IN ('Fixed', 'Range')");
                    table.CheckConstraint("CK_Commitment_Origin", "(\"OriginAlgorithmVersion\" IS NULL AND \"OriginEvidenceFingerprint\" IS NULL) OR (length(btrim(\"OriginAlgorithmVersion\")) > 0 AND octet_length(\"OriginEvidenceFingerprint\") = 32)");
                    table.CheckConstraint("CK_Commitment_Text", "length(btrim(\"Name\")) > 0 AND length(btrim(\"Category\")) > 0");
                    table.CheckConstraint("CK_Commitment_Timestamps", "\"UpdatedAt\" >= \"CreatedAt\"");
                    table.CheckConstraint("CK_Commitment_Timing", "(\"Cadence\" = 'Weekly' AND \"TimingKind\" = 'Weekday' AND \"ExpectedDayOfWeek\" IN ('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday') AND \"ExpectedDay\" IS NULL AND \"ExpectedMonth\" IS NULL) OR (\"Cadence\" = 'Monthly' AND \"TimingKind\" = 'DayOfMonth' AND \"ExpectedDayOfWeek\" IS NULL AND \"ExpectedDay\" BETWEEN 1 AND 31 AND \"ExpectedMonth\" IS NULL) OR (\"Cadence\" = 'Monthly' AND \"TimingKind\" = 'MonthEnd' AND \"ExpectedDayOfWeek\" IS NULL AND \"ExpectedDay\" IS NULL AND \"ExpectedMonth\" IS NULL) OR (\"Cadence\" = 'Yearly' AND \"TimingKind\" = 'MonthAndDay' AND \"ExpectedDayOfWeek\" IS NULL AND \"ExpectedMonth\" BETWEEN 1 AND 12 AND \"ExpectedDay\" BETWEEN 1 AND CASE WHEN \"ExpectedMonth\" = 2 THEN 29 WHEN \"ExpectedMonth\" IN (4, 6, 9, 11) THEN 30 ELSE 31 END)");
                    table.CheckConstraint("CK_Commitment_Windows", "\"WindowBeforeDays\" >= 0 AND \"WindowAfterDays\" >= 0");
                    table.ForeignKey(
                        name: "FK_Commitments_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CommitmentOccurrences",
                columns: table => new
                {
                    CommitmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExpenseId = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    LinkedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommitmentOccurrences", x => new { x.CommitmentId, x.ExpenseId });
                    table.CheckConstraint("CK_CommitmentOccurrence_Kind", "\"Kind\" = 'ConfirmationEvidence'");
                    table.ForeignKey(
                        name: "FK_CommitmentOccurrences_Commitments_CommitmentId",
                        column: x => x.CommitmentId,
                        principalTable: "Commitments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CommitmentOccurrences_Expenses_ExpenseId",
                        column: x => x.ExpenseId,
                        principalTable: "Expenses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "UX_CandidateDismissals_Owner_Origin",
                table: "CommitmentCandidateDismissals",
                columns: new[] { "OwnerId", "AlgorithmVersion", "Cadence", "EvidenceFingerprint" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CommitmentOccurrences_ExpenseId",
                table: "CommitmentOccurrences",
                column: "ExpenseId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_Commitments_Owner_OriginFingerprint",
                table: "Commitments",
                columns: new[] { "OwnerId", "OriginEvidenceFingerprint" },
                unique: true,
                filter: "\"OriginEvidenceFingerprint\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM "Commitments")
                        OR EXISTS (SELECT 1 FROM "CommitmentCandidateDismissals") THEN
                        RAISE EXCEPTION 'Cannot roll back commitment foundation while durable commitment decisions exist.';
                    END IF;
                END
                $migration$;
                """);

            migrationBuilder.DropTable(
                name: "CommitmentCandidateDismissals");

            migrationBuilder.DropTable(
                name: "CommitmentOccurrences");

            migrationBuilder.DropTable(
                name: "Commitments");

            migrationBuilder.DropColumn(
                name: "CommitmentEvidenceRevision",
                table: "Expenses");
        }
    }
}
