import SwiftUI

/// The Add expense / Add deposit sheet. While the form is open it is editable; once a save is
/// frozen it shows the locked values with the saving, uncertain or unreadable state.
struct CaptureSheet: View {
    let model: CaptureViewModel
    let l10n: L10n
    @FocusState private var focus: CaptureField?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(Text(verbatim: title))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        switch model.phase {
                        case .editing:
                            Button(l10n.string(.commonCancel)) { model.cancelEditing() }
                        case .uncertain, .unreadable:
                            Button(l10n.string(.commonClose)) { model.sheetDismissed() }
                        case .idle, .saving:
                            EmptyView()
                        }
                    }
                }
        }
        // A save in flight cannot be dismissed away; its result needs this screen.
        .interactiveDismissDisabled(model.phase == .saving)
        .onChange(of: model.phase) { _, phase in
            switch phase {
            case .saving: AccessibilityNotification.Announcement(l10n.string(.captureSaving)).post()
            case .uncertain: AccessibilityNotification.Announcement(l10n.string(.captureUncertainTitle)).post()
            case .editing, .unreadable, .idle: break
            }
        }
        .onChange(of: model.formError) { _, error in
            if let error { AccessibilityNotification.Announcement(l10n.string(CapturePresenter.formErrorKey(error))).post() }
        }
        .onChange(of: model.focusRequest) { _, request in
            if let request { focus = request.field }
        }
    }

    private var title: String {
        switch model.phase {
        case .uncertain, .unreadable: l10n.string(.capturePendingTitle)
        case .idle, .editing, .saving: l10n.string(CapturePresenter.titleKey(model.pending?.kind ?? model.kind))
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .editing:
            form
        case .saving, .uncertain, .unreadable:
            PendingSaveView(model: model, l10n: l10n)
        case .idle:
            Color.clear
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
                        .submitLabel(.next)
                        .accessibilityLabel(Text(verbatim: l10n.string(.captureFieldsDescription)))
                }
                fieldError(.description)

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

                if model.kind == .expense {
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
            } header: {
                Text(verbatim: l10n.string(CapturePresenter.legendKey(model.kind))).accessibilityAddTraits(.isHeader)
            } footer: {
                if model.kind == .deposit { Text(verbatim: l10n.string(.captureDepositHint)) }
            }

            if let error = model.formError {
                Section {
                    Label { Text(verbatim: l10n.string(CapturePresenter.formErrorKey(error))) } icon: {
                        Image(systemName: "exclamationmark.triangle")
                    }
                    .foregroundStyle(.red)
                    .font(.callout)
                }
            }

            Section {
                Button { model.submit() } label: {
                    Text(verbatim: l10n.string(CapturePresenter.saveKey(model.kind))).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder private func fieldError(_ field: CaptureField) -> some View {
        if model.fieldErrors.contains(field) {
            Label { Text(verbatim: l10n.string(CapturePresenter.fieldErrorKey(field))) } icon: {
                Image(systemName: "exclamationmark.triangle")
            }
            .foregroundStyle(.red)
            .font(.callout)
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
}

/// A caption above its control, so the label stays visible once the field has text and the
/// layout holds at large Dynamic Type sizes.
struct LabeledField<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: label).font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
            content
        }
    }
}
