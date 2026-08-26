import { formatDate, formatMoney } from "../utils/formatCommitments";

function sourceLabel(source) {
  return source === "sunflower_pdf" ? "Sunflower statement" : "Manual entry";
}

export default function CommitmentEvidence({ evidence }) {
  return (
    <div className="commitment-evidence">
      <h4>Supporting expenses</h4>
      <ul className="commitment-evidence__list">
        {evidence.map((expense) => (
          <li key={expense.expenseId} className="commitment-evidence__item">
            <div>
              <strong>{expense.description}</strong>
              <span>{formatDate(expense.date)} · {expense.category}</span>
              <span>{sourceLabel(expense.source)}</span>
            </div>
            <strong>{formatMoney(expense.amount)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
