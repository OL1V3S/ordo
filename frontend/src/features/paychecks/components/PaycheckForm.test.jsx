import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PaycheckForm from "./PaycheckForm";
import "../../../shared/localization/i18n";
import { makeCandidate, makePaycheck } from "../test/paycheckFixtures";

describe("PaycheckForm", () => {
  it("focuses the name, displays immutable candidate schedule and requires explicit submission", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const model = makeCandidate();
    render(<PaycheckForm mode="confirm" model={model} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Display name")).toHaveFocus();
    expect(screen.queryByLabelText("Cadence")).not.toBeInTheDocument();
    expect(screen.getByText("Monthly, day 10")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm paycheck" }));
    expect(onSubmit).toHaveBeenCalledWith({ displayName: "acme payroll", algorithmVersion: model.algorithmVersion,
      fingerprint: model.fingerprint, schedule: model.schedule, windowBeforeDays: 1, windowAfterDays: 1,
      amount: { mode: "fixed", fixedAmount: "2500", minimumAmount: null, maximumAmount: null } });
  });

  it("leaves variable acceptance blank, focuses described errors, and submits only explicit ranges", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PaycheckForm mode="confirm" model={makeCandidate({ observedAmount: { mode: "variable", minimumAmount: 2000, maximumAmount: 3000 } })} onSubmit={onSubmit} />);
    expect(screen.getByLabelText("Minimum amount")).toHaveValue("");
    expect(screen.getByLabelText("Maximum amount")).toHaveValue("");
    expect(screen.queryByRole("option", { name: "Fixed amount" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm paycheck" }));
    expect(onSubmit).not.toHaveBeenCalled();
    const minimum = screen.getByLabelText("Minimum amount");
    expect(minimum).toHaveFocus();
    expect(minimum).toHaveAttribute("aria-invalid", "true");
    expect(minimum).toHaveAccessibleDescription(/positive amount/);
    await user.type(minimum, "2100.01");
    await user.type(screen.getByLabelText("Maximum amount"), "2900.99");
    await user.click(screen.getByRole("button", { name: "Confirm paycheck" }));
    expect(onSubmit.mock.calls[0][0].amount).toEqual({ mode: "range", fixedAmount: null, minimumAmount: "2100.01", maximumAmount: "2900.99" });
  });

  it("clears inactive schedule and amount fields and creates a complete manual profile", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PaycheckForm mode="manual" onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Display name"), "  New payroll  ");
    await user.type(screen.getByLabelText("Monthly anchor day"), "10");
    await user.type(screen.getByLabelText("Fixed amount"), "100");
    await user.selectOptions(screen.getByLabelText("Cadence"), "biweekly");
    fireEvent.change(screen.getByLabelText("Reference anchor date"), { target: { value: "2026-03-08" } });
    await user.selectOptions(screen.getByLabelText("Amount model"), "range");
    expect(screen.getByLabelText("Minimum amount")).toHaveValue("");
    await user.type(screen.getByLabelText("Minimum amount"), "100.01");
    await user.type(screen.getByLabelText("Maximum amount"), "100.02");
    await user.click(screen.getByRole("button", { name: "Create paycheck" }));
    expect(onSubmit).toHaveBeenCalledWith({ displayName: "New payroll", windowBeforeDays: 0, windowAfterDays: 0,
      schedule: { cadence: "biweekly", referenceAnchorDate: "2026-03-08", firstMonthAnchor: null, secondMonthAnchor: null },
      amount: { mode: "range", fixedAmount: null, minimumAmount: "100.01", maximumAmount: "100.02" } });
  });

  it("rejects invalid semimonthly spacing and decimal precision before submitting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PaycheckForm mode="manual" onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Display name"), "Payroll");
    await user.selectOptions(screen.getByLabelText("Cadence"), "semimonthly");
    await user.type(screen.getByLabelText("First anchor day"), "1");
    await user.selectOptions(screen.getByLabelText("Second anchor"), "month_end");
    await user.type(screen.getByLabelText("Fixed amount"), "100.001");
    await user.click(screen.getByRole("button", { name: "Create paycheck" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Second anchor")).toHaveFocus();
    expect(screen.getByLabelText("Second anchor")).toHaveAccessibleDescription(/February/);
    expect(screen.getByLabelText("Fixed amount")).toHaveValue("100.001");
  });

  it("sends restricted edits, prevents duplicate submits, and preserves drafts after failures", async () => {
    const user = userEvent.setup();
    let reject;
    const onSubmit = vi.fn(() => new Promise((resolve, rejectPromise) => { reject = rejectPromise; }));
    render(<PaycheckForm mode="edit" model={makePaycheck()} onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Revised payroll");
    const form = screen.getByRole("form", { name: "Save changes" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(Object.keys(onSubmit.mock.calls[0][0])).toEqual(["displayName", "windowBeforeDays", "windowAfterDays", "amount"]);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Fixed amount")).toBeDisabled();
    reject(new Error("private response must not be shown"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The action could not be completed"));
    expect(screen.getByLabelText("Display name")).toHaveValue("Revised payroll");
    expect(screen.queryByText(/private response/)).not.toBeInTheDocument();
  });

  it("disables all controls when busy and delegates cancel without saving", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(<PaycheckForm mode="edit" model={makePaycheck()} busy onSubmit={onSubmit} onCancel={onCancel} />);
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    rerender(<PaycheckForm mode="edit" model={makePaycheck()} onSubmit={onSubmit} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("explains unsafe numeric amounts persistently instead of accepting rounded values", () => {
    render(<PaycheckForm mode="edit" model={makePaycheck({ amount: { mode: "fixed", fixedAmount: 1e16 } })} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Fixed amount")).toHaveValue("");
    expect(screen.getByText(/could not be loaded with reliable cent precision/)).toBeInTheDocument();
  });

  it("blocks uncertain resubmission while keeping cancel and draft inputs available", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(<PaycheckForm mode="edit" model={makePaycheck()} submitDisabled onSubmit={onSubmit} onCancel={onCancel} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByLabelText("Display name")).not.toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Save changes" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
