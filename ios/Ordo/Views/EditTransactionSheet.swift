import SwiftUI

/// Edits one expense or deposit. While the form is open it is editable; once the request is frozen
/// it shows the locked values with the saving or unknown-outcome state.
struct EditTransactionSheet: View {
    let model: TransactionMutationViewModel
    let l10n: L10n
    @FocusState private var focus: CaptureField?

    private var presenter: TransactionsPresenter { TransactionsPresenter(l10n: l10n) }
    private var kind: CaptureKind { model.target?.captureKind ?? .expense }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(Text(verbatim: presenter.editTitle(kind)))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        switch model.phase {
                        case .editing:
                            Button(l10n.string(.commonCancel)) { model.cancelEditing() }
                        case .uncertain:
                            Button(l10n.string(.commonClose)) { model.sheetDismissed() }
                        case .idle, .confirmingDelete, .submitting:
                            EmptyView()
                        }
                    }
                }
        }
        // A request in flight cannot be dismissed away; its result needs this screen.
        .interactiveDismissDisabled(model.phase == .submitting)
        .onChange(of: model.phase) { _, phase in
            switch phase {
            case .submitting: AccessibilityNotification.Announcement(l10n.string(.captureSaving)).post()
            case .uncertain:
                AccessibilityNotification.Announcement(
                    l10n.string(TransactionsPresenter.uncertainTitleKey(isDelete: model.isDeleteFlow))).post()
            case .idle, .editing, .confirmingDelete: break
            }
        }
        .onChange(of: model.formError) { _, error in
            if let error { AccessibilityNotification.Announcement(l10n.string(TransactionsPresenter.formErrorKey(error))).post() }
        }
        .onChange(of: model.focusRequest) { _, request in
            if let request { focus = request.field }
        }
        .sensoryFeedback(.warning, trigger: model.phase) { _, phase in phase == .uncertain }
        .sensoryFeedback(.error, trigger: model.formError) { _, error in error != nil }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .editing: form
        case .submitting, .uncertain: lockedView
        case .idle, .confirmingDelete: Color.clear
        }
    }

    // MARK: Form

    private var form: some View {
        Form {
            Section {
                LabeledField(label: l10n.string(.captureFieldsDescription)) {
                    TextField("", text: binding(\.description))
                        .textInputAutocapitalization(.sentences)
                        .focused($focus, equals: .description)
                        .accessibilityLabel(Text(verbatim: l10n.string(.captureFieldsDescription)))
                }
                fieldError(.description)

                if case .needsReview = model.target?.amount {
                    VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                        InlineStatusView(systemImage: "exclamationmark.triangle",
                                         message: l10n.string(.cashInFormAmountReviewTitle), tone: .warning)
                        Text(verbatim: l10n.string(.cashInFormAmountReviewBody))
                            .font(Theme.Typography.meta.font)
                            .foregroundStyle(ThemeColor.text.color)
                    }
                    .accessibilityElement(children: .combine)
                }
                LabeledField(label: l10n.string(.captureFieldsAmount)) {
                    TextField("", text: binding(\.amountText))
                        .keyboardType(.decimalPad)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .amount)
                        .accessibilityLabel(Text(verbatim: l10n.string(.captureFieldsAmount)))
                }
                fieldError(.amount)

                DatePicker(l10n.string(.captureFieldsDate), selection: dateBinding, displayedComponents: .date)
                    .environment(\.timeZone, model.timeZone)
                fieldError(.date)

                if kind == .expense {
                    Picker(l10n.string(.captureFieldsCategory), selection: categoryBinding) {
                        ForEach(CategoryChoice.allCases, id: \.self) { choice in
                            Text(verbatim: l10n.string(choice.labelKey)).tag(choice)
                        }
                    }
                    if model.draft.category == .custom {
                        LabeledField(label: l10n.string(.captureFieldsCustomCategory)) {
                            TextField("", text: binding(\.customCategory))
                                .focused($focus, equals: .category)
                                .accessibilityLabel(Text(verbatim: l10n.string(.captureFieldsCustomCategory)))
                        }
                    }
                    fieldError(.category)
                }
            } footer: {
                if kind == .deposit {
                    Text(verbatim: l10n.string(.cashInFormEditWarning))
                        .font(Theme.Typography.finePrint.font)
                        .foregroundStyle(ThemeColor.textMuted.color)
                }
            }
            .themedRows()

            if let error = model.formError {
                Section {
                    InlineStatusView(systemImage: "exclamationmark.triangle",
                                     message: l10n.string(TransactionsPresenter.formErrorKey(error)), tone: .danger)
                }
                .themedToneRow(.danger)
            }

            Section {
                Button { model.submitEdit() } label: {
                    Text(verbatim: l10n.string(.cashInFormSaveChanges)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoPrimaryButtonStyle())
            }
            .themedButtonRow()
        }
        .themedList()
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder private func fieldError(_ field: CaptureField) -> some View {
        if model.fieldErrors.contains(field) {
            InlineStatusView(systemImage: "exclamationmark.triangle",
                             message: l10n.string(CapturePresenter.fieldErrorKey(field)), tone: .danger)
        }
    }

    private func binding(_ keyPath: WritableKeyPath<CaptureDraft, String>) -> Binding<String> {
        Binding(get: { model.draft[keyPath: keyPath] }, set: { value in model.edit { $0[keyPath: keyPath] = value } })
    }

    private var dateBinding: Binding<Date> {
        Binding(get: { CaptureDates.date(from: model.draft.date, timeZone: model.timeZone) },
                set: { value in
                    model.edit { $0.date = CaptureDates.calendarDate(from: value, timeZone: model.timeZone) }
                })
    }

    private var categoryBinding: Binding<CategoryChoice> {
        Binding(get: { model.draft.category }, set: { value in model.edit { $0.category = value } })
    }

    // MARK: Locked

    private var lockedView: some View {
        Form {
            Section { MutationStatusContent(model: model, l10n: l10n) }
                .themedToneRow(model.phase == .uncertain ? .warning : .neutral)
            if case .update(let values)? = model.request?.operation { summary(values) }
        }
        .themedList()
    }

    private func summary(_ values: CaptureValidation.FrozenValues) -> some View {
        let amount = Money.parse(values.amount).map {
            MoneyFormatter(language: l10n.language, currencyCode: "USD").string($0)
        } ?? values.amount
        let date = CalendarDate(values.date).map { DateFormatting.string($0, language: l10n.language) } ?? values.date
        return Section {
            summaryRow(l10n.string(.captureFieldsDescription), values.descriptionText)
            summaryRow(l10n.string(.captureFieldsAmount), amount)
            summaryRow(l10n.string(.captureFieldsDate), date)
            if kind == .expense {
                summaryRow(l10n.string(.captureFieldsCategory), CategoryLabel.label(for: values.category, l10n: l10n))
            }
        } footer: {
            Text(verbatim: l10n.string(.captureLocked))
                .font(Theme.Typography.finePrint.font)
                .foregroundStyle(ThemeColor.textMuted.color)
        }
        .themedRows()
    }

    private func summaryRow(_ label: String, _ value: String) -> some View {
        LabeledContent {
            Text(verbatim: value).foregroundStyle(ThemeColor.text.color)
        } label: {
            Text(verbatim: label).foregroundStyle(ThemeColor.textMuted.color)
        }
    }
}
