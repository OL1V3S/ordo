import { createElement } from "react";

// `titleAs` (default "strong") lets a row expose its title as a heading. `children` is an optional
// full-width slot under the row (details, forms, confirmations); the wrap modifier is only added
// when it is used, so rows without children keep their exact DOM and layout.
export default function ListRow({ className = "", label, title, titleAs = "strong", meta, amount, actions, children, ...rest }) {
  const hasExtra = children != null && children !== false;
  const classes = `ui-list-row ${hasExtra ? "ui-list-row--with-extra " : ""}${className}`.trim();
  return (
    <li {...rest} className={classes}>
      <div className="ui-list-row__main">
        {label != null && <span className="ui-list-row__label">{label}</span>}
        {createElement(titleAs, { className: "ui-list-row__title" }, title)}
        {meta != null && <p className="ui-list-row__meta">{meta}</p>}
      </div>
      {amount != null && <div className="ui-list-row__amount">{amount}</div>}
      {actions && <div className="ui-list-row__actions">{actions}</div>}
      {hasExtra && <div className="ui-list-row__extra">{children}</div>}
    </li>
  );
}
