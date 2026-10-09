// Extra props (ref, tabIndex, aria-live, id) reach the <p>; role always follows tone and cannot be overridden.
export default function StatusMessage({ tone = "info", className = "", children, ...rest }) {
  return (
    <p {...rest} className={`status-message status-message--${tone} ${className}`.trim()} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </p>
  );
}
