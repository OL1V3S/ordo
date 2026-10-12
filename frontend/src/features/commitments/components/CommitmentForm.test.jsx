import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CommitmentForm from "./CommitmentForm";
import "../../../shared/localization/i18n";

const model = {
  description: "Membership",
  category: "health",
  cadence: "monthly",
  timingKind: "dayofmonth",
  expectedDay: 15,
  windowBeforeDays: 1,
  windowAfterDays: 1,
  observedAmountMode: "fixed",
  observedMedianAmount: 20,
  observedMinimumAmount: 20,
  observedMaximumAmount: 20,
};

function renderForm(onSubmit = vi.fn()) {
  render(
    <CommitmentForm
      model={model}
      fingerprint="candidate-1"
      submitLabel="Confirm recurring expense"
      busy={false}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />
  );
  return onSubmit;
}

describe("commitment expectation form", () => {
  it("sends weekly weekday timing and a variable amount range without monthly fields", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.selectOptions(screen.getByLabelText("How often"), "weekly");
    await user.selectOptions(screen.getByLabelText("Expected weekday"), "tuesday");
    await user.selectOptions(screen.getByLabelText("Amount type"), "range");
    await user.click(screen.getByRole("button", { name: "Confirm recurring expense" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      cadence: "weekly",
      timingKind: "weekday",
      expectedDayOfWeek: "tuesday",
      expectedDay: null,
      expectedMonth: null,
      amountMode: "range",
      expectedAmount: null,
      expectedMinimumAmount: "20.00",
      expectedMaximumAmount: "20.00",
    }));
  });

  it("sends month-end timing without an expected calendar day", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.selectOptions(screen.getByLabelText("Monthly date"), "monthend");
    await user.click(screen.getByRole("button", { name: "Confirm recurring expense" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      cadence: "monthly",
      timingKind: "monthend",
      expectedDay: null,
      expectedMonth: null,
    }));
  });

  it("sends an explicit month and day for yearly timing", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.selectOptions(screen.getByLabelText("How often"), "yearly");
    await user.clear(screen.getByLabelText("Expected month"));
    await user.type(screen.getByLabelText("Expected month"), "2");
    await user.clear(screen.getByLabelText("Expected day"));
    await user.type(screen.getByLabelText("Expected day"), "28");
    await user.click(screen.getByRole("button", { name: "Confirm recurring expense" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      cadence: "yearly",
      timingKind: "monthandday",
      expectedDayOfWeek: null,
      expectedMonth: 2,
      expectedDay: 28,
    }));
  });

  it("blocks confirmation when a legacy candidate amount cannot be reconstructed exactly", () => {
    render(
      <CommitmentForm
        model={{ ...model, observedMedianAmount: Number("9999999999999999") }}
        fingerprint="candidate-unsafe"
        submitLabel="Confirm recurring expense"
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/couldn't load the exact amount/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm recurring expense" })).toBeDisabled();
  });
});
