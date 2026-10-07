import { Eye, EyeOff } from "lucide-react";

export default function PasswordField({
  id,
  label,
  placeholder,
  value,
  onChange,
  isRevealed,
  onToggle,
  describedBy,
  showLabel,
  hideLabel,
}) {
  return (
    <div className="auth-field">
      <label className="auth-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="password-field">
        <input
          id={id}
          type={isRevealed ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          aria-describedby={describedBy}
          required
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={isRevealed ? hideLabel : showLabel}
          aria-pressed={isRevealed}
          onClick={onToggle}
        >
          {isRevealed ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
