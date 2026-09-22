import { formatDate, formatDerivedMoney } from "../utils/formatCommitments";
import { displayText } from "../../../utils/text";

function sourceLabel(source) {
  return source === "sunflower_pdf" ? "Sunflower statement" : "Manual entry";
}

export default function CommitmentEvidence({ evidence, heading = "Supporting expenses" }) {
  return (
    <div className="commitment-evidence">
      <h4>{heading}</h4>
      <ul className="commitment-evidence__list">
        {evidence.map((expense) => (
          <li key={expense.expenseId} className="commitment-evidence__item">
            <div>
              <strong>{expense.description}</strong>
              <span>{formatDate(expense.date)} · {displayText(expense.category)}</span>
              <span>{sourceLabel(expense.source)}</span>
            </div>
            <strong>{formatDerivedMoney(expense.amount)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
