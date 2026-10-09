export default function ListRow({ className = "", label, title, meta, amount, actions, ...rest }) {
  return (
    <li {...rest} className={`ui-list-row ${className}`.trim()}>
      <div className="ui-list-row__main">
        {label != null && <span className="ui-list-row__label">{label}</span>}
        <strong className="ui-list-row__title">{title}</strong>
        {meta != null && <p className="ui-list-row__meta">{meta}</p>}
      </div>
      {amount != null && <div className="ui-list-row__amount">{amount}</div>}
      {actions && <div className="ui-list-row__actions">{actions}</div>}
    </li>
  );
}
