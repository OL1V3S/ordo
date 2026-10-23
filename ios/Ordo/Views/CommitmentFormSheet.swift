import SwiftUI

/// Review and confirm a possible recurring expense, or edit a saved one: the web's form, prefilled
/// from what the server observed or saved. Nothing is saved until Confirm or Save changes.
struct CommitmentFormSheet: View {
    let model: RecurringViewModel
    let presenter: RecurringPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        NavigationStack {
            Group {
                if let session = model.confirm, model.showsConfirmForm {
                    form(session)
                } else {
                    List {
                        InlineStatusView(systemImage: "exclamationmark.triangle",
                                         message: l10n.string(model.isEditing ? .commitmentsFeedbackErrorsCommitmentNotFound
                                                              : .commitmentsFeedbackErrorsCandidateChanged), tone: .warning)
                            .themedRows()
                    }
                    .themedList()
                }
            }
            .themedCanvas()
            .navigationTitle(Text(verbatim: l10n.string(model.isEditing ? .commitmentsSavedEdit : .commitmentsCandidatesConfirmCommitment)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(l10n.string(.commitmentsFormCancel)) { model.cancelConfirm(); model.sheetDismissed() }
                        .disabled(model.writePhase == .submitting)
                }
            }
        }
        .interactiveDismissDisabled(model.writePhase == .submitting)
    }

    private func form(_ session: RecurringViewModel.ConfirmSession) -> some View {
        let draft = session.draft
        return Form {
            if model.writePhase != .idle {
                Section { RecurringStatusContent(model: model, l10n: l10n) }.themedRows()
            }
            if draft.observedUnsafe {
                Section {
                    InlineStatusView(systemImage: "exclamationmark.triangle",
                                     message: l10n.string(.commitmentsFormObservedAmountUnsafe), tone: .warning)
                }
                .themedToneRow(.warning)
            }
            Section {
                LabeledField(label: l10n.string(.commitmentsFormName)) {
                    TextField("", text: binding(\.name))
                        .textInputAutocapitalization(.sentences)
                        .accessibilityLabel(Text(verbatim: l10n.string(.commitmentsFormName)))
                }
                fieldError(session, .name)
                LabeledField(label: l10n.string(.commitmentsFormCategory)) {
                    TextField("", text: binding(\.category))
                        .accessibilityLabel(Text(verbatim: l10n.string(.commitmentsFormCategory)))
                }
                fieldError(session, .category)
                Picker(l10n.string(.commitmentsFormCadence), selection: cadenceBinding) {
                    ForEach(ConfirmDraft.Cadence.allCases, id: \.self) { Text(verbatim: presenter.cadence($0.rawValue)).tag($0) }
                }
                if draft.cadence == .weekly {
                    Picker(l10n.string(.commitmentsFormExpectedWeekday), selection: binding(\.weekday)) {
                        ForEach(ConfirmDraft.weekdays, id: \.self) { Text(verbatim: presenter.weekday($0)).tag($0) }
                    }
                }
                if draft.cadence == .monthly {
                    Picker(l10n.string(.commitmentsFormMonthlyTiming), selection: monthlyBinding) {
                        Text(verbatim: l10n.string(.commitmentsFormDayOfMonth)).tag(ConfirmDraft.MonthlyTiming.dayofmonth)
                        Text(verbatim: l10n.string(.commitmentsFormMonthEnd)).tag(ConfirmDraft.MonthlyTiming.monthend)
                    }
                }
                if draft.cadence == .yearly {
                    numberField(.commitmentsFormExpectedMonth, \.monthText)
                }
                if draft.showsDay { numberField(.commitmentsFormExpectedDay, \.dayText) }
                numberField(.commitmentsFormDaysBefore, \.beforeText)
                numberField(.commitmentsFormDaysAfter, \.afterText)
                fieldError(session, .timing)
            }
            .themedRows()
            .disabled(model.writePhase != .idle)

            Section {
                Picker(l10n.string(.commitmentsFormAmountModel), selection: amountModeBinding) {
                    Text(verbatim: l10n.string(.commitmentsFormFixedAmount)).tag(ConfirmDraft.AmountMode.fixed)
                    Text(verbatim: l10n.string(.commitmentsFormAmountRange)).tag(ConfirmDraft.AmountMode.range)
                }
                if draft.amountMode == .fixed {
                    amountField(.commitmentsFormExpectedAmount, \.expectedText)
                } else {
                    amountField(.commitmentsFormMinimumAmount, \.minimumText)
                    amountField(.commitmentsFormMaximumAmount, \.maximumText)
                }
                fieldError(session, .amount)
            }
            .themedRows()
            .disabled(model.writePhase != .idle)

            if let code = session.errorCode {
                Section {
                    InlineStatusView(systemImage: "exclamationmark.triangle",
                                     message: l10n.string(RecurringPresenter.errorKey(code)), tone: .danger)
                }
                .themedToneRow(.danger)
            }

            Section {
                Button { model.submitConfirm() } label: {
                    Text(verbatim: l10n.string(model.isEditing ? .commitmentsSavedSaveChanges : .commitmentsCandidatesConfirmCommitment))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoPrimaryButtonStyle())
                .disabled(!model.canWrite || draft.observedUnsafe)
            }
            .themedButtonRow()
        }
        .themedList()
        .scrollDismissesKeyboard(.interactively)
    }

    private func numberField(_ key: L10nKey, _ keyPath: WritableKeyPath<ConfirmDraft, String>) -> some View {
        LabeledField(label: l10n.string(key)) {
            TextField("", text: binding(keyPath))
                .keyboardType(.numberPad)
                .accessibilityLabel(Text(verbatim: l10n.string(key)))
        }
    }

    private func amountField(_ key: L10nKey, _ keyPath: WritableKeyPath<ConfirmDraft, String>) -> some View {
        LabeledField(label: l10n.string(key)) {
            TextField("", text: binding(keyPath))
                .keyboardType(.decimalPad)
                .autocorrectionDisabled()
                .accessibilityLabel(Text(verbatim: l10n.string(key)))
        }
    }

    @ViewBuilder private func fieldError(_ session: RecurringViewModel.ConfirmSession, _ field: ConfirmField) -> some View {
        if session.fieldErrors.contains(field) {
            InlineStatusView(systemImage: "exclamationmark.triangle",
                             message: l10n.string(RecurringPresenter.fieldErrorKey(field)), tone: .danger)
        }
    }

    private func binding(_ keyPath: WritableKeyPath<ConfirmDraft, String>) -> Binding<String> {
        Binding(get: { model.confirm?.draft[keyPath: keyPath] ?? "" },
                set: { value in model.editConfirm { $0[keyPath: keyPath] = value } })
    }

    private var cadenceBinding: Binding<ConfirmDraft.Cadence> {
        Binding(get: { model.confirm?.draft.cadence ?? .monthly }, set: { value in model.editConfirm { $0.setCadence(value) } })
    }

    private var monthlyBinding: Binding<ConfirmDraft.MonthlyTiming> {
        Binding(get: { model.confirm?.draft.monthlyTiming ?? .dayofmonth },
                set: { value in model.editConfirm { $0.monthlyTiming = value; if value == .dayofmonth, $0.dayText.isEmpty { $0.dayText = "1" } } })
    }

    private var amountModeBinding: Binding<ConfirmDraft.AmountMode> {
        Binding(get: { model.confirm?.draft.amountMode ?? .fixed }, set: { value in model.editConfirm { $0.amountMode = value } })
    }
}
