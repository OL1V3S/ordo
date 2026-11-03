using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddBudgetLimitUniqueness : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Guard: counts only, never deletes or rewrites rows. Aborts the migration when existing
            // data would violate the canonical-category uniqueness rule.
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    bad_rows bigint;
                    duplicate_groups bigint;
                BEGIN
                    SELECT count(*) INTO bad_rows
                    FROM "BudgetLimits"
                    WHERE btrim("Category") = ''
                       OR "Category" <> lower(regexp_replace(btrim("Category"), '\s+', ' ', 'g'))
                       OR "LimitAmount" < 0
                       OR "MonthYear" <> date_trunc('month', "MonthYear", 'UTC');

                    IF bad_rows > 0 THEN
                        RAISE EXCEPTION 'AddBudgetLimitUniqueness aborted: % BudgetLimits rows have a blank or non-canonical category, a negative amount, or a MonthYear that is not the first day of a UTC month. Resolve them manually first.', bad_rows;
                    END IF;

                    SELECT count(*) INTO duplicate_groups FROM (
                        SELECT 1
                        FROM "BudgetLimits"
                        GROUP BY "UserId",
                                 lower(regexp_replace(btrim("Category"), '\s+', ' ', 'g')),
                                 date_trunc('month', "MonthYear", 'UTC')
                        HAVING count(*) > 1
                    ) d;

                    IF duplicate_groups > 0 THEN
                        RAISE EXCEPTION 'AddBudgetLimitUniqueness aborted: % duplicate (user, category, month) groups in BudgetLimits. Resolve them manually first.', duplicate_groups;
                    END IF;
                END
                $$;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_BudgetLimits_UserId_Category_MonthYear",
                table: "BudgetLimits",
                columns: new[] { "UserId", "Category", "MonthYear" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BudgetLimits_UserId_Category_MonthYear",
                table: "BudgetLimits");
        }
    }
}
