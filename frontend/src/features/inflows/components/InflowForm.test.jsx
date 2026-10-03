import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import InflowForm from "./InflowForm";
import "../../../shared/localization/i18n";

const draft = { description: "Client payment", amount: "1250.50", date: "2026-08-14" };

function formProps(overrides = {}) {
  return {
    draft,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    pending: false,
    disabled: false,
    fieldErrors: {},
    mode: "create",
    amountNeedsReview: false,
    ...overrides,
  };
}

describe("InflowForm", () => {
  it("focuses the description and delegates exact draft strings without transforming a payload", () => {
    const props = formProps();
    render(<InflowForm {...props} />);

    expect(screen.getByLabelText("Description")).toHaveFocus();
    expect(screen.getByRole("form", { name: "Add cash in" })).toHaveAttribute("novalidate");

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "  Mixed CASE  spacing  " } });
    expect(props.onChange).toHaveBeenLastCalledWith({
      description: "  Mixed CASE  spacing  ",
      amount: "1250.50",
      date: "2026-08-14",
    });

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "001.230" } });
    expect(props.onChange).toHaveBeenLastCalledWith({
      description: "Client payment",
      amount: "001.230",
      date: "2026-08-14",
    });
    fireEvent.submit(screen.getByRole("form", { name: "Add cash in" }));
    expect(props.onSubmit).toHaveBeenCalledWith();
  });

  it("does not truncate a valid 500-character description surrounded by outer spaces", () => {
    const rawDescription = `  ${"a".repeat(500)}  `;
    const onChange = vi.fn();
    const props = formProps({ draft: { ...draft, description: "" }, onChange });
    const { rerender } = render(<InflowForm {...props} />);
    const description = screen.getByLabelText("Description");

    expect(description).not.toHaveAttribute("maxlength");
    fireEvent.change(description, { target: { value: rawDescription } });
    expect(onChange).toHaveBeenCalledWith({ ...draft, description: rawDescription });

    rerender(<InflowForm {...props} draft={{ ...draft, description: rawDescription }} />);
    expect(screen.getByLabelText("Description")).toHaveValue(rawDescription);
  });

  it("focuses the first invalid field only when the errors change", () => {
    const props = formProps();
    const { rerender } = render(<InflowForm {...props} />);

    rerender(<InflowForm {...props} fieldErrors={{ amount: "Enter a positive amount.", date: "Enter a valid date." }} />);
    const amount = screen.getByLabelText("Amount");
    expect(amount).toHaveFocus();
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAccessibleDescription("Enter a positive amount.");

    screen.getByLabelText("Date").focus();
    rerender(<InflowForm {...props} fieldErrors={{ amount: "Enter a positive amount.", date: "Enter a valid date." }} />);
    expect(screen.getByLabelText("Date")).toHaveFocus();

    rerender(<InflowForm {...props} fieldErrors={{ description: "Enter a description." }} />);
    expect(screen.getByLabelText("Description")).toHaveFocus();
  });

  it("locks fields and cancel while pending, and otherwise leaves cancel available", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(<InflowForm {...formProps({ pending: true, onCancel, onSubmit })} />);

    expect(screen.getByLabelText("Description")).toBeDisabled();
    expect(screen.getByLabelText("Amount")).toBeDisabled();
    expect(screen.getByLabelText("Date")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Add cash in" }));
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<InflowForm {...formProps({ disabled: true, onCancel, onSubmit })} />);
    expect(screen.getByRole("button", { name: "Add cash in" })).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps edit consequences and unsafe amount re-entry guidance visible", () => {
    render(<InflowForm {...formProps({ mode: "edit", amountNeedsReview: true, draft: { ...draft, amount: "" } })} />);

    expect(screen.getByRole("form", { name: "Edit cash in" })).toBeInTheDocument();
    expect(screen.getByText(/If this entry supports a saved paycheck/)).toBeVisible();
    expect(screen.getByText(/Amount needs review/)).toBeVisible();
    expect(screen.getByText(/Enter the exact amount again/)).toBeVisible();
    expect(screen.getByLabelText("Amount")).toHaveValue("");
  });
});
