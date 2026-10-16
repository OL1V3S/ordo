using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddDeviceSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DeviceSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    SecretHash = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: false),
                    SecurityStampHash = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AbsoluteExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeviceSessions", x => x.Id);
                    table.CheckConstraint("CK_DeviceSession_Expiry", "\"AbsoluteExpiresAt\" > \"CreatedAt\"");
                    table.CheckConstraint("CK_DeviceSession_LastUsed", "\"LastUsedAt\" >= \"CreatedAt\"");
                    table.CheckConstraint("CK_DeviceSession_SecretHash", "octet_length(\"SecretHash\") = 32");
                    table.CheckConstraint("CK_DeviceSession_StampHash", "octet_length(\"SecurityStampHash\") = 32");
                    table.ForeignKey(
                        name: "FK_DeviceSessions_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeviceSessions_OwnerId",
                table: "DeviceSessions",
                column: "OwnerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DeviceSessions");
        }
    }
}
