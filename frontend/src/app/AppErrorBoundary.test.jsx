import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppErrorBoundary from "./AppErrorBoundary";
import { LocaleProvider } from "../shared/localization/LocaleProvider";
import i18n from "../shared/localization/i18n";

function Boom() {
  throw new Error("secret-token-123 account 4242");
}

function renderBoundary() {
  return render(
    <LocaleProvider>
      <AppErrorBoundary><Boom /></AppErrorBoundary>
    </LocaleProvider>,
  );
}

describe("AppErrorBoundary", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("renders children when nothing throws", () => {
    render(<LocaleProvider><AppErrorBoundary><p>ok</p></AppErrorBoundary></LocaleProvider>);
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("shows an accessible fallback without error details", () => {
    const { container } = renderBoundary();
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(container.textContent).not.toMatch(/secret-token|4242|Error:/);
  });

  it("reloads the page from a focusable action", async () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      renderBoundary();
      const button = screen.getByRole("button", { name: "Reload" });
      button.focus();
      expect(button).toHaveFocus();
      await userEvent.click(button);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("is localized in es-MX", async () => {
    await i18n.changeLanguage("es");
    renderBoundary();
    expect(screen.getByRole("alert")).toHaveTextContent("Algo salió mal");
    expect(screen.getByRole("button", { name: "Recargar" })).toBeInTheDocument();
  });
});
