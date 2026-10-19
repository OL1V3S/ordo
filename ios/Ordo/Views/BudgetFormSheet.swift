import SwiftUI

/// Adds a category budget or edits one limit, for the selected month. The fields stay editable
/// after an unconfirmed change; only Save is held back (until the limits are read again) and Cancel
/// stays available. While a request is on its way everything is locked.
struct BudgetFormSheet: View {
    let model: BudgetsViewModel
    let presenter: BudgetsPresenter
    @FocusState private var focus: BudgetField?

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(Text(verbatim: model.task.map(presenter.formHeading) ?? ""))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(l10n.string(.commonCancel)) { model.cancelTask() }
                            .disabled(model.isPending)
                    }
                }
        }
        // A request in flight cannot be dismissed away; its result needs this screen.
        .interactiveDismissDisabled(model.isPending)
        .onChange(of: model.showsValidation) { _, shows in
            if shows { AccessibilityNotification.Announcement(l10n.string(.budgetsFormValidation)).post() }
        }
        .onChange(of: model.isPending) { _, pending in
            if pending { AccessibilityNotification.Announcement(l10n.string(.captureSaving)).post() }
        }
        .onChange(of: model.feedback) { _, feedback in
            if let feedback { AccessibilityNotification.Announcement(l10n.string(BudgetsPresenter.feedbackKey(feedback))).post() }
        }
        .onChange(of: model.focusRequest) { _, request in
            guard let request else { return }
            switch request.field {
            case .customCategory: focus = .customCategory
            case .amount: focus = .amount
            case .category: break // a picker takes no keyboard focus; the message is announced
            }
        }
        .sensoryFeedback(.error, trigger: model.showsValidation) { _, shows in shows }
    }

    @ViewBuilder private var content: some View {
        if let task = model.task {
            form(task)
        } else {
            Color.clear
        }
    }

    private func form(_ task: BudgetsViewModel.TaskKind) -> some View {
        Form {
            Section {
                Text(verbatim: presenter.forMonth(model.month))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
                if case .add = task {
                    Picker(l10n.string(.budgetsFormCategory), selection: choiceBinding) {
                        Text(verbatim: l10n.string(.budgetsFormCategoryPlaceholder)).tag(BudgetCategoryChoice?.none)
                        ForEach(BudgetCategoryChoice.allCases, id: \.self) { choice in
                            Text(verbatim: l10n.string(choice.labelKey)).tag(BudgetCategoryChoice?.some(choice))
                        }
                    }
                    if model.draft.choice == .other {
                        LabeledField(label: l10n.string(.budgetsFormCustomCategory)) {
                            TextField(l10n.string(.budgetsFormCustomCategoryPlaceholder), text: customBinding)
                                .focused($focus, equals: .customCategory)
                                .accessibilityLabel(Text(verbatim: l10n.string(.budgetsFormCustomCategory)))
                        }
                    }
                }
                LabeledField(label: presenter.limitFieldLabel(task)) {
                    TextField(l10n.string(.budgetsFormLimitAmountPlaceholder), text: amountBinding)
                        .keyboardType(.decimalPad)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .amount)
                        .accessibilityLabel(Text(verbatim: presenter.limitFieldLabel(task)))
                }
            }
            .themedRows()
            .disabled(model.isPending)

            if model.showsValidation {
                Section {
                    InlineStatusView(systemImage: "exclamationmark.triangle",
                                     message: l10n.string(.budgetsFormValidation), tone: .danger)
                }
                .themedToneRow(.danger)
            }

            if let feedback = model.feedback {
                // The change is unconfirmed: read the limits again, check them, then save again.
                Section {
                    InlineStatusView(systemImage: BudgetsPresenter.feedbackIcon(feedback),
                                     message: l10n.string(BudgetsPresenter.feedbackKey(feedback)),
                                     tone: BudgetsPresenter.feedbackTone(feedback))
                    if model.needsRefresh {
                        Button { Task { await model.refreshLimits() } } label: {
                            Text(verbatim: l10n.string(.budgetsSectionRefresh)).frame(maxWidth: .infinity)
                        }
                        .buttonStyle(OrdoSecondaryButtonStyle())
                        .disabled(!model.canRefreshLimits)
                    }
                }
                .themedToneRow(BudgetsPresenter.feedbackTone(feedback))
            }

            Section {
                Button { model.save() } label: {
                    Text(verbatim: l10n.string(model.isPending ? .captureSaving : .budgetsFormSave)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoPrimaryButtonStyle())
                .disabled(!model.canSave)
            }
            .themedButtonRow()
        }
        .themedList()
        .scrollDismissesKeyboard(.interactively)
    }

    private var choiceBinding: Binding<BudgetCategoryChoice?> {
        Binding(get: { model.draft.choice }, set: { value in model.edit { $0.choice = value } })
    }

    private var customBinding: Binding<String> {
        Binding(get: { model.draft.customCategory }, set: { value in model.edit { $0.customCategory = value } })
    }

    private var amountBinding: Binding<String> {
        Binding(get: { model.draft.amountText }, set: { value in model.edit { $0.amountText = value } })
    }
}
