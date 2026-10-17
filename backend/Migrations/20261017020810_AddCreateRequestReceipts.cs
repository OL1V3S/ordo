using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddCreateRequestReceipts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CreateRequestReceipts",
                columns: table => new
                {
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    RequestKey = table.Column<Guid>(type: "uuid", nullable: false),
                    RecordKind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    RequestFingerprint = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: false),
                    ExpenseId = table.Column<int>(type: "integer", nullable: true),
                    AccountInflowId = table.Column<int>(type: "integer", nullable: true),
                    AccountInflowOwnerId = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CreateRequestReceipts", x => new { x.OwnerId, x.RequestKey });
                    table.CheckConstraint("CK_CreateRequestReceipt_Fingerprint", "octet_length(\"RequestFingerprint\") = 32");
                    table.CheckConstraint("CK_CreateRequestReceipt_InflowOwner", "(\"AccountInflowId\" IS NULL AND \"AccountInflowOwnerId\" IS NULL) OR (\"AccountInflowId\" IS NOT NULL AND \"AccountInflowOwnerId\" = \"OwnerId\")");
                    table.CheckConstraint("CK_CreateRequestReceipt_Kind", "\"RecordKind\" IN ('Expense', 'AccountInflow')");
                    table.CheckConstraint("CK_CreateRequestReceipt_KindLink", "(\"RecordKind\" = 'Expense' AND \"AccountInflowId\" IS NULL AND \"AccountInflowOwnerId\" IS NULL) OR (\"RecordKind\" = 'AccountInflow' AND \"ExpenseId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_CreateRequestReceipts_AccountInflow_Owner",
                        columns: x => new { x.AccountInflowId, x.AccountInflowOwnerId },
                        principalTable: "AccountInflows",
                        principalColumns: new[] { "Id", "OwnerId" },
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_CreateRequestReceipts_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CreateRequestReceipts_Expenses_ExpenseId",
                        column: x => x.ExpenseId,
                        principalTable: "Expenses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CreateRequestReceipts_AccountInflowId",
                table: "CreateRequestReceipts",
                column: "AccountInflowId",
                unique: true,
                filter: "\"AccountInflowId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CreateRequestReceipts_AccountInflowId_AccountInflowOwnerId",
                table: "CreateRequestReceipts",
                columns: new[] { "AccountInflowId", "AccountInflowOwnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_CreateRequestReceipts_ExpenseId",
                table: "CreateRequestReceipts",
                column: "ExpenseId",
                unique: true,
                filter: "\"ExpenseId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CreateRequestReceipts");
        }
    }
}
