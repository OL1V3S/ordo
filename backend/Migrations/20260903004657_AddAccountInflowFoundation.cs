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
                    AccountInflowId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportInflowProvenances", x => new { x.BatchId, x.SourceRowOrdinal });
                    table.CheckConstraint("CK_ImportInflowProvenance_PositiveSourceRowOrdinal", "\"SourceRowOrdinal\" > 0");
                    table.ForeignKey(
                        name: "FK_ImportInflowProvenances_AccountInflows_AccountInflowId",
                        column: x => x.AccountInflowId,
                        principalTable: "AccountInflows",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_ImportInflowProvenances_ImportPreviewBatches_BatchId",
                        column: x => x.BatchId,
                        principalTable: "ImportPreviewBatches",
                        principalColumn: "Id",
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
        }
    }
}
