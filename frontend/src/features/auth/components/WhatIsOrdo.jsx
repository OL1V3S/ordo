import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useFocusReturn from "../../../shared/ui/useFocusReturn";

// One row per shipped area, in the same order as the iOS "What is Ordo?" sheet.
const AREAS = [
  { nav: "home", detail: "home" },
  { nav: "activity", detail: "transactions" },
  { nav: "budgets", detail: "budgets" },
  { nav: "commitments", detail: "commitments" },
  { nav: "paychecks", detail: "paychecks" },
  { nav: "insights", detail: "reports" },
];

function Dialog({ onClosed }) {
  const { t } = useTranslation(["auth", "navigation"]);
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    // showModal focuses the Close button, which opens a phone-size dialog scrolled to the bottom.
    titleRef.current?.focus();
  }, []);

  function close() {
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.close === "function" && dialog.open) dialog.close();
    else onClosed();
  }

  return (
    <dialog
      ref={dialogRef}
      className="whats-ordo-dialog"
      aria-labelledby={titleId}
      onClose={onClosed}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="whats-ordo-dialog__body">
        <h2 ref={titleRef} id={titleId} tabIndex={-1} className="whats-ordo-dialog__title">{t("auth:whatIsOrdo.title")}</h2>
        <p className="whats-ordo-dialog__intro">{t("auth:whatIsOrdo.intro")}</p>
        <ul role="list" className="whats-ordo-dialog__list">
          {AREAS.map(({ nav, detail }) => (
            <li key={nav}>
              <span className="whats-ordo-dialog__area">{t(`navigation:destinations.${nav}.label`)}</span>
              <span className="whats-ordo-dialog__detail">{t(`auth:whatIsOrdo.${detail}`)}</span>
            </li>
          ))}
        </ul>
        <p className="whats-ordo-dialog__note">{t("auth:whatIsOrdo.note")}</p>
        <button type="button" className="button-ghost whats-ordo-dialog__close" onClick={close}>
          {t("auth:whatIsOrdo.close")}
        </button>
      </div>
    </dialog>
  );
}

// Sign-in only: a secondary button that opens a modal tour of the shipped areas.
export default function WhatIsOrdo() {
  const { t } = useTranslation("auth");
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);
  const focus = useFocusReturn();

  function open() {
    focus.remember(triggerRef.current);
    setIsOpen(true);
  }

  function closed() {
    setIsOpen(false);
    focus.restore(triggerRef);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="button-ghost auth-text-action"
        aria-haspopup="dialog"
        onClick={open}
      >
        {t("whatIsOrdo.title")}
      </button>
      {isOpen && <Dialog onClosed={closed} />}
    </>
  );
}
