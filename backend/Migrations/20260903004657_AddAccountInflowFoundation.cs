using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountInflowFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_ImportPreviewBatches_Id_OwnerId",
                table: "ImportPreviewBatches",
                columns: new[] { "Id", "OwnerId" });

            migrationBuilder.CreateTable(
                name: "AccountInflows",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    PaycheckEvidenceRevision = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountInflows", x => x.Id);
                    table.UniqueConstraint("AK_AccountInflows_Id_OwnerId", x => new { x.Id, x.OwnerId });
                    table.CheckConstraint("CK_AccountInflow_Description", "length(btrim(\"Description\")) > 0");
                    table.CheckConstraint("CK_AccountInflow_PositiveAmount", "\"Amount\" > 0");
                    table.ForeignKey(
                        name: "FK_AccountInflows_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ImportInflowProvenances",
                columns: table => new
                {
                    BatchId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceRowOrdinal = table.Column<int>(type: "integer", nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    AccountInflowId = table.Column<int>(type: "integer", nullable: true),
                    AccountInflowOwnerId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportInflowProvenances", x => new { x.BatchId, x.SourceRowOrdinal });
                    table.CheckConstraint("CK_ImportInflowProvenance_OwnerConsistency", "(\"AccountInflowId\" IS NULL AND \"AccountInflowOwnerId\" IS NULL) OR (\"AccountInflowId\" IS NOT NULL AND \"AccountInflowOwnerId\" IS NOT NULL AND \"AccountInflowOwnerId\" = \"OwnerId\")");
                    table.CheckConstraint("CK_ImportInflowProvenance_PositiveSourceRowOrdinal", "\"SourceRowOrdinal\" > 0");
                    table.ForeignKey(
                        name: "FK_ImportInflowProvenance_AccountInflow_Owner",
                        columns: x => new { x.AccountInflowId, x.AccountInflowOwnerId },
                        principalTable: "AccountInflows",
                        principalColumns: new[] { "Id", "OwnerId" },
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_ImportInflowProvenance_Batch_Owner",
                        columns: x => new { x.BatchId, x.OwnerId },
                        principalTable: "ImportPreviewBatches",
                        principalColumns: new[] { "Id", "OwnerId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AccountInflows_OwnerId_Date",
                table: "AccountInflows",
                columns: new[] { "OwnerId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_ImportInflowProvenances_AccountInflowId",
                table: "ImportInflowProvenances",
                column: "AccountInflowId",
                unique: true,
                filter: "\"AccountInflowId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ImportInflowProvenances_AccountInflowId_AccountInflowOwnerId",
                table: "ImportInflowProvenances",
                columns: new[] { "AccountInflowId", "AccountInflowOwnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_ImportInflowProvenances_BatchId_OwnerId",
                table: "ImportInflowProvenances",
                columns: new[] { "BatchId", "OwnerId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM "AccountInflows")
                        OR EXISTS (SELECT 1 FROM "ImportInflowProvenances") THEN
                        RAISE EXCEPTION 'Cannot roll back account inflow foundation while durable inflow evidence exists.';
                    END IF;
                END $migration$;
                """);

            migrationBuilder.DropTable(
                name: "ImportInflowProvenances");

            migrationBuilder.DropTable(
                name: "AccountInflows");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_ImportPreviewBatches_Id_OwnerId",
                table: "ImportPreviewBatches");
        }
    }
}
