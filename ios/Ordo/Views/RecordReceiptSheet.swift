import SwiftUI

/// Link a received paycheck to the current or previous slot the server lists: a new deposit or a
/// saved one. Advisory warnings never block.
struct RecordReceiptSheet: View {
    let model: PaychecksViewModel
    let presenter: PaychecksPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        NavigationStack {
            Group {
                if let session = model.receipt, let profile = model.receiptProfile {
                    form(session, profile)
                } else {
                    // The schedule disappeared from the latest read.
                    List {
                        InlineStatusView(systemImage: "exclamationmark.triangle",
                                         message: l10n.string(.paychecksFeedbackErrorsPaycheckNotFound), tone: .warning)
                            .themedRows()
                    }
                    .themedList()
                }
            }
            .themedCanvas()
            .navigationTitle(Text(verbatim: l10n.string(.paychecksReceiptHeading)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(l10n.string(.paychecksReceiptCancel)) { model.cancelReceipt(); model.sheetDismissed() }
                        .disabled(model.writePhase == .submitting)
                }
            }
        }
        .interactiveDismissDisabled(model.writePhase == .submitting)
    }

    private func form(_ session: PaychecksViewModel.ReceiptSession, _ profile: PaycheckProfile) -> some View {
        Form {
            if model.writePhase != .idle {
                Section { PaychecksStatusContent(model: model, l10n: l10n) }.themedRows()
            }
            Section {
                Text(verbatim: l10n.string(.paychecksReceiptIntro))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
                Picker(l10n.string(.paychecksReceiptSlotLabel), selection: slotBinding) {
                    ForEach(profile.slots, id: \.anchor) { slot in
                        Text(verbatim: presenter.slotLabel(slot)).tag(Optional(slot.anchor))
                    }
                    if model.isSlotStale, let remembered = session.rememberedSlot {
                        Text(verbatim: presenter.slotLabel(remembered, stale: true)).tag(Optional(remembered.anchor))
                    }
                }
                if model.isSlotStale {
                    InlineStatusView(systemImage: "exclamationmark.triangle",
                                     message: l10n.string(.paychecksIosStaleSlotNote), tone: .warning)
                }
                Picker(l10n.string(.paychecksReceiptSourceLegend), selection: sourceBinding) {
                    Text(verbatim: l10n.string(.paychecksReceiptSourceNew)).tag(ReceiptDraft.Source.new)
                    Text(verbatim: l10n.string(.paychecksReceiptSourceExisting)).tag(ReceiptDraft.Source.existing)
                }
                .pickerStyle(.segmented)
            }
            .themedRows()
            .disabled(model.writePhase != .idle)

            Section {
                switch session.draft.source {
                case .new: newFields(session)
                case .existing: existingList(session)
                }
            }
            .themedRows()
            .disabled(model.writePhase != .idle)

            ForEach(model.warnings, id: \.self) { warning in
                Section {
                    InlineStatusView(systemImage: "info.circle", message: presenter.warning(warning), tone: .info)
                }
                .themedToneRow(.info)
            }

            if let code = session.errorCode {
                Section {
                    InlineStatusView(systemImage: "exclamationmark.triangle",
                                     message: l10n.string(PaychecksPresenter.errorKey(code)), tone: .danger)
                }
                .themedToneRow(.danger)
            }

            Section {
                Button { model.submitReceipt() } label: {
                    Text(verbatim: l10n.string(.paychecksReceiptLink)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoPrimaryButtonStyle())
                .disabled(!model.canWrite || model.isSlotStale
                          || (session.draft.source == .existing && session.draft.existingInflowId == nil))
            }
            .themedButtonRow()
        }
        .themedList()
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder private func newFields(_ session: PaychecksViewModel.ReceiptSession) -> some View {
        LabeledField(label: l10n.string(.captureFieldsDescription)) {
            TextField("", text: draftBinding(\.descriptionText))
                .textInputAutocapitalization(.sentences)
                .accessibilityLabel(Text(verbatim: l10n.string(.captureFieldsDescription)))
        }
        fieldError(session, .description)
        LabeledField(label: l10n.string(.captureFieldsAmount)) {
            TextField("", text: draftBinding(\.amountText))
                .keyboardType(.decimalPad)
                .autocorrectionDisabled()
                .accessibilityLabel(Text(verbatim: l10n.string(.captureFieldsAmount)))
        }
        fieldError(session, .amount)
        DatePicker(l10n.string(.captureFieldsDate), selection: dateBinding, displayedComponents: .date)
            .environment(\.timeZone, model.timeZone)
        fieldError(session, .date)
    }

    @ViewBuilder private func existingList(_ session: PaychecksViewModel.ReceiptSession) -> some View {
        switch model.depositsState {
        case .idle, .loading:
            HStack(spacing: Theme.Space.s3.points) {
                ProgressView().tint(ThemeColor.accent.color)
                Text(verbatim: l10n.string(.paychecksIosDepositsLoading))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            .accessibilityElement(children: .combine)
        case .failed:
            InlineStatusView(systemImage: "exclamationmark.triangle",
                             message: l10n.string(.paychecksReceiptLoadError), tone: .danger)
        case .loaded:
            TextField(l10n.string(.paychecksReceiptSearch), text: draftBinding(\.search))
                .autocorrectionDisabled()
            let deposits = model.linkableDeposits
            if deposits.isEmpty {
                Text(verbatim: l10n.string(.paychecksReceiptNoMatches))
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            ForEach(deposits) { deposit in
                Button { model.editReceipt { $0.existingInflowId = deposit.id } } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                            Text(verbatim: deposit.text)
                                .font(Theme.Typography.rowTitle.font)
                                .foregroundStyle(ThemeColor.text.color)
                            Text(verbatim: "\(presenter.date(deposit.date)) · \(presenter.money(deposit.amount))")
                                .font(Theme.Typography.meta.font)
                                .foregroundStyle(ThemeColor.textMuted.color)
                        }
                        Spacer()
                        if session.draft.existingInflowId == deposit.id {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(ThemeColor.accent.color)
                        }
                    }
                }
                .accessibilityAddTraits(session.draft.existingInflowId == deposit.id ? .isSelected : [])
            }
        }
    }

    @ViewBuilder private func fieldError(_ session: PaychecksViewModel.ReceiptSession, _ field: ReceiptField) -> some View {
        if session.fieldErrors.contains(field) {
            InlineStatusView(systemImage: "exclamationmark.triangle",
                             message: l10n.string(PaychecksPresenter.fieldErrorKey(field)), tone: .danger)
        }
    }

    private func draftBinding(_ keyPath: WritableKeyPath<ReceiptDraft, String>) -> Binding<String> {
        Binding(get: { model.receipt?.draft[keyPath: keyPath] ?? "" },
                set: { value in model.editReceipt { $0[keyPath: keyPath] = value } })
    }

    private var dateBinding: Binding<Date> {
        Binding(get: { CaptureDates.date(from: model.receipt?.draft.date ?? CalendarDate(year: 1970, month: 1, day: 1)!,
                                         timeZone: model.timeZone) },
                set: { value in model.editReceipt { $0.date = CaptureDates.calendarDate(from: value, timeZone: model.timeZone) } })
    }

    private var slotBinding: Binding<CalendarDate?> {
        Binding(get: { model.receipt?.draft.slotAnchor }, set: { value in model.editReceipt { $0.slotAnchor = value } })
    }

    private var sourceBinding: Binding<ReceiptDraft.Source> {
        Binding(get: { model.receipt?.draft.source ?? .new }, set: { value in model.editReceipt { $0.source = value } })
    }
}
