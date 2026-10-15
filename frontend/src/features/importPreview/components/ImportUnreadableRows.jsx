import { useTranslation } from "react-i18next";
import { displayText } from "../../../utils/text";

// Content-less invalid rows are not shown in the table. They stay unselectable and are never
// saved; this note keeps them visible so the user can check the statement.
export default function ImportUnreadableRows({ rows }) {
  const { t } = useTranslation("importPreview");
  if (rows.length === 0) return null;
  return (
    <details className="import-unreadable">
      <summary>{t("unreadable.summary", { count: rows.length })}</summary>
      <p className="muted">{t("unreadable.note")}</p>
      <ul className="import-unreadable__list">
        {rows.map((row) => {
          const values = {
            row: row.sourceRowOrdinal,
            reason: t("unreadable.reason"),
            section: row.sourceSection
              ? t(`row.sections.${row.sourceSection}`, { defaultValue: displayText(row.sourceSection.replaceAll("_", " ")) })
              : "",
          };
          return <li key={row.rowId}>{t(row.sourceSection ? "unreadable.item" : "unreadable.itemNoSection", values)}</li>;
        })}
      </ul>
    </details>
  );
}
