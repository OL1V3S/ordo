import { useSyncExternalStore } from "react";
import { Trans, useTranslation } from "react-i18next";
import { clearRequestReference, getRequestReference, subscribeToRequestReference } from "../api/requestReference";
import StatusMessage from "./StatusMessage";

// Global notice after a server error (#340): shows the latest support reference until dismissed
// or the session changes. Shown only when the response carried a valid ID.
export default function RequestReferenceNotice() {
  const { t } = useTranslation("common");
  const id = useSyncExternalStore(subscribeToRequestReference, getRequestReference);
  if (!id) return null;

  return (
    <StatusMessage tone="danger" className="request-reference-notice">
      <Trans i18nKey="requestReference.message" ns="common" values={{ id }} components={{ code: <code /> }} />
      <button type="button" className="button-ghost" onClick={clearRequestReference}>
        {t("requestReference.dismiss")}
      </button>
    </StatusMessage>
  );
}
