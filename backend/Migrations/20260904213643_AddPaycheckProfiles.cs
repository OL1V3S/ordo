using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddPaycheckProfiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PaycheckCandidateDismissals",
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
                    table.PrimaryKey("PK_PaycheckCandidateDismissals", x => x.Id);
                    table.CheckConstraint("CK_PaycheckCandidateDismissal_AlgorithmVersion", "length(btrim(\"AlgorithmVersion\")) > 0");
                    table.CheckConstraint("CK_PaycheckCandidateDismissal_Cadence", "\"Cadence\" IN ('Weekly', 'Biweekly', 'Semimonthly', 'Monthly')");
                    table.CheckConstraint("CK_PaycheckCandidateDismissal_FingerprintLength", "octet_length(\"EvidenceFingerprint\") = 32");
                    table.ForeignKey(
                        name: "FK_PaycheckCandidateDismissals_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PaycheckProfiles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Lifecycle = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Cadence = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ReferenceAnchorDate = table.Column<DateOnly>(type: "date", nullable: true),
                    FirstMonthAnchor = table.Column<short>(type: "smallint", nullable: true),
                    SecondMonthAnchor = table.Column<short>(type: "smallint", nullable: true),
                    WindowBeforeDays = table.Column<short>(type: "smallint", nullable: false),
                    WindowAfterDays = table.Column<short>(type: "smallint", nullable: false),
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
                    table.PrimaryKey("PK_PaycheckProfiles", x => x.Id);
                    table.UniqueConstraint("AK_PaycheckProfiles_Id_OwnerId", x => new { x.Id, x.OwnerId });
                    table.CheckConstraint("CK_PaycheckProfile_Amount", "(\"AmountMode\" = 'Fixed' AND \"ExpectedAmount\" IS NOT NULL AND \"ExpectedAmount\" > 0 AND \"ExpectedMinimumAmount\" IS NULL AND \"ExpectedMaximumAmount\" IS NULL) OR (\"AmountMode\" = 'Range' AND \"ExpectedAmount\" IS NULL AND \"ExpectedMinimumAmount\" IS NOT NULL AND \"ExpectedMinimumAmount\" > 0 AND \"ExpectedMaximumAmount\" IS NOT NULL AND \"ExpectedMaximumAmount\" > \"ExpectedMinimumAmount\")");
                    table.CheckConstraint("CK_PaycheckProfile_Enums", "\"Lifecycle\" IN ('Active', 'Paused', 'Ended') AND \"Cadence\" IN ('Weekly', 'Biweekly', 'Semimonthly', 'Monthly') AND \"AmountMode\" IN ('Fixed', 'Range')");
                    table.CheckConstraint("CK_PaycheckProfile_Origin", "(\"OriginAlgorithmVersion\" IS NULL AND \"OriginEvidenceFingerprint\" IS NULL) OR (\"OriginAlgorithmVersion\" IS NOT NULL AND length(btrim(\"OriginAlgorithmVersion\")) > 0 AND \"OriginEvidenceFingerprint\" IS NOT NULL AND octet_length(\"OriginEvidenceFingerprint\") = 32)");
                    table.CheckConstraint("CK_PaycheckProfile_Schedule", "(\"Cadence\" IN ('Weekly', 'Biweekly') AND \"ReferenceAnchorDate\" IS NOT NULL AND \"FirstMonthAnchor\" IS NULL AND \"SecondMonthAnchor\" IS NULL) OR (\"Cadence\" = 'Monthly' AND \"ReferenceAnchorDate\" IS NULL AND \"FirstMonthAnchor\" IS NOT NULL AND \"FirstMonthAnchor\" BETWEEN 1 AND 31 AND \"SecondMonthAnchor\" IS NULL) OR (\"Cadence\" = 'Semimonthly' AND \"ReferenceAnchorDate\" IS NULL AND \"FirstMonthAnchor\" IS NOT NULL AND \"SecondMonthAnchor\" IS NOT NULL AND \"FirstMonthAnchor\" BETWEEN 1 AND 31 AND \"SecondMonthAnchor\" BETWEEN 1 AND 31 AND \"FirstMonthAnchor\" < \"SecondMonthAnchor\" AND LEAST(\"SecondMonthAnchor\", 28) - LEAST(\"FirstMonthAnchor\", 28) >= 7 AND 28 - LEAST(\"SecondMonthAnchor\", 28) + LEAST(\"FirstMonthAnchor\", 28) >= 7)");
                    table.CheckConstraint("CK_PaycheckProfile_Text", "length(btrim(\"DisplayName\")) > 0");
                    table.CheckConstraint("CK_PaycheckProfile_Timestamps", "\"UpdatedAt\" >= \"CreatedAt\"");
                    table.CheckConstraint("CK_PaycheckProfile_Windows", "\"WindowBeforeDays\" BETWEEN 0 AND 3 AND \"WindowAfterDays\" BETWEEN 0 AND 3");
                    table.ForeignKey(
                        name: "FK_PaycheckProfiles_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PaycheckOccurrences",
                columns: table => new
                {
                    PaycheckProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountInflowId = table.Column<int>(type: "integer", nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    EvidenceRevisionAtAssignment = table.Column<Guid>(type: "uuid", nullable: false),
                    SlotAnchor = table.Column<DateOnly>(type: "date", nullable: false),
                    TimingOffsetDays = table.Column<short>(type: "smallint", nullable: false),
                    LinkedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaycheckOccurrences", x => new { x.PaycheckProfileId, x.AccountInflowId });
                    table.CheckConstraint("CK_PaycheckOccurrence_EvidenceRevision", "\"EvidenceRevisionAtAssignment\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.CheckConstraint("CK_PaycheckOccurrence_Kind", "\"Kind\" = 'ConfirmationEvidence'");
                    table.CheckConstraint("CK_PaycheckOccurrence_TimingOffset", "\"TimingOffsetDays\" BETWEEN -3 AND 3");
                    table.ForeignKey(
                        name: "FK_PaycheckOccurrence_AccountInflow_Owner",
                        columns: x => new { x.AccountInflowId, x.OwnerId },
                        principalTable: "AccountInflows",
                        principalColumns: new[] { "Id", "OwnerId" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PaycheckOccurrence_Profile_Owner",
                        columns: x => new { x.PaycheckProfileId, x.OwnerId },
                        principalTable: "PaycheckProfiles",
                        principalColumns: new[] { "Id", "OwnerId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "UX_PaycheckCandidateDismissals_Owner_Origin",
                table: "PaycheckCandidateDismissals",
                columns: new[] { "OwnerId", "AlgorithmVersion", "Cadence", "EvidenceFingerprint" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaycheckOccurrences_AccountInflowId",
                table: "PaycheckOccurrences",
                column: "AccountInflowId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaycheckOccurrences_AccountInflowId_OwnerId",
                table: "PaycheckOccurrences",
                columns: new[] { "AccountInflowId", "OwnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_PaycheckOccurrences_PaycheckProfileId_OwnerId",
                table: "PaycheckOccurrences",
                columns: new[] { "PaycheckProfileId", "OwnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_PaycheckProfiles_OwnerId",
                table: "PaycheckProfiles",
                column: "OwnerId");

            migrationBuilder.CreateIndex(
                name: "UX_PaycheckProfiles_Owner_Origin",
                table: "PaycheckProfiles",
                columns: new[] { "OwnerId", "OriginAlgorithmVersion", "OriginEvidenceFingerprint" },
                unique: true,
                filter: "\"OriginEvidenceFingerprint\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PaycheckOccurrences");

            migrationBuilder.DropTable(
                name: "PaycheckCandidateDismissals");

            migrationBuilder.DropTable(
                name: "PaycheckProfiles");
        }
    }
}
