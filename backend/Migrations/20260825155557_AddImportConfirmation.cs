using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddImportConfirmation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ConfirmedAt",
                table: "ImportPreviewBatches",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ImportExpenseProvenances",
                columns: table => new
                {
                    BatchId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceRowOrdinal = table.Column<int>(type: "integer", nullable: false),
                    ExpenseId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportExpenseProvenances", x => new { x.BatchId, x.SourceRowOrdinal });
                    table.CheckConstraint("CK_ImportExpenseProvenance_PositiveSourceRowOrdinal", "\"SourceRowOrdinal\" > 0");
                    table.ForeignKey(
                        name: "FK_ImportExpenseProvenances_Expenses_ExpenseId",
                        column: x => x.ExpenseId,
                        principalTable: "Expenses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_ImportExpenseProvenances_ImportPreviewBatches_BatchId",
                        column: x => x.BatchId,
                        principalTable: "ImportPreviewBatches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ImportPreviewBatches_ActiveDocument",
                table: "ImportPreviewBatches",
                columns: new[] { "OwnerId", "SourceType", "ParserRuleVersion", "DocumentDigest" },
                unique: true,
                filter: "\"Lifecycle\" IN ('Open', 'Confirmed')");

            migrationBuilder.CreateIndex(
                name: "IX_ImportPreviewBatches_ConfirmedDocument",
                table: "ImportPreviewBatches",
                columns: new[] { "OwnerId", "SourceType", "ParserRuleVersion", "DocumentDigest" },
                unique: true,
                filter: "\"Lifecycle\" = 'Confirmed'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ImportPreviewBatch_ConfirmedAt",
                table: "ImportPreviewBatches",
                sql: "(\"Lifecycle\" = 'Confirmed' AND \"ConfirmedAt\" IS NOT NULL) OR (\"Lifecycle\" <> 'Confirmed' AND \"ConfirmedAt\" IS NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_ImportExpenseProvenances_ExpenseId",
                table: "ImportExpenseProvenances",
                column: "ExpenseId",
                unique: true,
                filter: "\"ExpenseId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM "ImportPreviewBatches"
                        WHERE "Lifecycle" = 'Confirmed' OR "ConfirmedAt" IS NOT NULL
                    ) OR EXISTS (
                        SELECT 1
                        FROM "ImportExpenseProvenances"
                    ) THEN
                        RAISE EXCEPTION 'Cannot remove import confirmation schema while confirmed import data exists.';
                    END IF;
                END $migration$;
                """);

            migrationBuilder.DropTable(
                name: "ImportExpenseProvenances");

            migrationBuilder.DropIndex(
                name: "IX_ImportPreviewBatches_ActiveDocument",
                table: "ImportPreviewBatches");

            migrationBuilder.DropIndex(
                name: "IX_ImportPreviewBatches_ConfirmedDocument",
                table: "ImportPreviewBatches");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ImportPreviewBatch_ConfirmedAt",
                table: "ImportPreviewBatches");

            migrationBuilder.DropColumn(
                name: "ConfirmedAt",
                table: "ImportPreviewBatches");
        }
    }
}
