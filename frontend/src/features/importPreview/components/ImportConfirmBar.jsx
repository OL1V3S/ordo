import { useLayoutEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { formatTotal } from "../utils/importReview";
import { useLocale } from "../../../shared/localization/useLocale";

const HEIGHT_PROPERTY = "--import-confirm-bar-height";
// If the bar would cover more than this share of the viewport (short screens, heavy zoom, long
// wrapped guidance) it stops sticking so it cannot hide the rows it confirms (plan D12).
const MAX_STICKY_VIEWPORT_SHARE = 0.4;

// Publishes the bar's measured height on its container so rows can reserve exactly that much
// scroll margin, and reports whether the bar may stay sticky. Without ResizeObserver (older
// browsers, jsdom) nothing is published and CSS falls back to a conservative default.
function useStickyMeasurement(barRef) {
  const [sticky, setSticky] = useState(true);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const host = bar?.parentElement;
    if (!bar || !host || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const height = bar.getBoundingClientRect().height;
      if (!(height > 0)) return;
      const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
      const canStick = !(viewport > 0 && height > viewport * MAX_STICKY_VIEWPORT_SHARE);
      setSticky(canStick);
      host.style.setProperty(HEIGHT_PROPERTY, canStick ? `${Math.ceil(height)}px` : "0px");
    };
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      host.style.removeProperty(HEIGHT_PROPERTY);
    };
  }, [barRef]);
  return sticky;
}

// The single confirm action plus exact, separate totals for expenses and incoming deposits.
// Totals are static text; only the guidance line is a live region. No net or balance wording.
export default function ImportConfirmBar({
  selectedItemsLabel,
  totals,
  guidance,
  disabled,
  confirming,
  confirmLabel,
  onConfirm,
}) {
  const { t } = useTranslation("importPreview");
  const { locale } = useLocale();
  const barRef = useRef(null);
  const sticky = useStickyMeasurement(barRef);
  return (
    <div ref={barRef} className="import-confirm-bar" data-sticky={sticky ? "true" : "false"} role="group" aria-label={t("bar.label")}>
      <div className="import-confirm-bar__summary">
        <p className="import-confirmation-actions__selection">
          <Trans t={t} i18nKey="results.selected" values={{ items: selectedItemsLabel }} components={{ strong: <strong /> }} />
        </p>
        <p className="import-confirm-bar__total">
          {t("bar.expensesToSave", { count: totals.expenseCount, total: formatTotal(t, totals.expenseCents, locale) })}
        </p>
        <p className="import-confirm-bar__total">
          {t("bar.depositsToSave", { count: totals.depositCount, total: formatTotal(t, totals.depositCents, locale) })}
        </p>
        <p id="import-confirmation-guidance" className="muted import-confirm-bar__guidance" role="status" aria-live="polite">
          {guidance}
        </p>
      </div>
      <button
        type="button"
        disabled={disabled}
        aria-busy={confirming}
        aria-describedby="import-confirmation-guidance"
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
