import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "./LocaleProvider";
import LanguageControl from "./LanguageControl";
import i18n from "./i18n";

function StatefulFixture() {
  const [draft, setDraft] = useState("");
  return (
    <>
      <LanguageControl />
      <input aria-label="Local draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    </>
  );
}

describe("LanguageControl", () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage("en");
  });

  afterEach(() => vi.restoreAllMocks());

  it("switches language in place, retains focus, and preserves local state", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><StatefulFixture /></LocaleProvider>);
    const draft = screen.getByRole("textbox", { name: "Local draft" });
    await user.type(draft, "Keep this draft");
    const language = screen.getByRole("combobox", { name: "Language preference" });

    await user.selectOptions(language, "es");

    expect(language).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "Preferencia de idioma" })).toBe(language);
    expect(draft).toHaveValue("Keep this draft");
    expect(document.documentElement).toHaveAttribute("lang", "es");
    expect(localStorage.getItem("ordo-language")).toBe("es");
  });

  it("applies the selected language when persistence fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    render(<LocaleProvider><LanguageControl /></LocaleProvider>);

    await user.selectOptions(screen.getByRole("combobox", { name: "Language preference" }), "es");

    expect(screen.getByRole("combobox", { name: "Preferencia de idioma" })).toHaveValue("es");
    expect(document.documentElement).toHaveAttribute("lang", "es");
  });
});
