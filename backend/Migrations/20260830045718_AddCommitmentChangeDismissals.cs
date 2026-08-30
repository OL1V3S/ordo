using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddCommitmentChangeDismissals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CommitmentChangeDismissals",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    CommitmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    AlgorithmVersion = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Dimension = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EvidenceFingerprint = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: false),
                    DismissedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommitmentChangeDismissals", x => x.Id);
                    table.CheckConstraint("CK_CommitmentChangeDismissal_AlgorithmVersion", "length(btrim(\"AlgorithmVersion\")) > 0");
                    table.CheckConstraint("CK_CommitmentChangeDismissal_Dimension", "\"Dimension\" IN ('Amount', 'Timing', 'Missing')");
                    table.CheckConstraint("CK_CommitmentChangeDismissal_FingerprintLength", "octet_length(\"EvidenceFingerprint\") = 32");
                    table.ForeignKey(
                        name: "FK_CommitmentChangeDismissals_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CommitmentChangeDismissals_Commitments_CommitmentId",
                        column: x => x.CommitmentId,
                        principalTable: "Commitments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CommitmentChangeDismissals_CommitmentId",
                table: "CommitmentChangeDismissals",
                column: "CommitmentId");

            migrationBuilder.CreateIndex(
                name: "IX_CommitmentChangeDismissals_Owner_Commitment",
                table: "CommitmentChangeDismissals",
                columns: new[] { "OwnerId", "CommitmentId" });

            migrationBuilder.CreateIndex(
                name: "UX_CommitmentChangeDismissals_Owner_Assessment",
                table: "CommitmentChangeDismissals",
                columns: new[] { "OwnerId", "CommitmentId", "AlgorithmVersion", "Dimension", "EvidenceFingerprint" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM "CommitmentChangeDismissals") THEN
                        RAISE EXCEPTION 'Cannot roll back commitment change dismissals while durable decisions exist.';
                    END IF;
                END $$;
                """);

            migrationBuilder.DropTable(
                name: "CommitmentChangeDismissals");
        }
    }
}
