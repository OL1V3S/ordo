import SwiftUI

/// Edits an expense row's description and category. Saving sends one request and closes the sheet;
/// the outcome (including an unknown one) is shown on the review screen.
struct ImportRowEditSheet: View {
    let model: ImportViewModel
    let row: ImportRow
    let presenter: ImportPresenter
    let l10n: L10n
    @Environment(\.dismiss) private var dismiss
    @State private var description: String
    @State private var choice: CategoryChoice
    @State private var custom: String
    @State private var invalidCategory = false

    init(model: ImportViewModel, row: ImportRow, presenter: ImportPresenter, l10n: L10n) {
        self.model = model
        self.row = row
        self.presenter = presenter
        self.l10n = l10n
        _description = State(initialValue: row.editableExpenseDescription ?? "")
        let stored = (row.category ?? "uncategorized")
        if let known = CategoryChoice(rawValue: stored), known != .custom {
            _choice = State(initialValue: known)
            _custom = State(initialValue: "")
        } else {
            _choice = State(initialValue: .custom)
            _custom = State(initialValue: stored)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(presenter.text("row.fields.description"), text: $description)
                    Picker(presenter.text("row.fields.category"), selection: $choice) {
                        ForEach(CategoryChoice.allCases, id: \.self) { Text(verbatim: l10n.string($0.labelKey)).tag($0) }
                    }
                    if choice == .custom {
                        TextField(presenter.text("row.fields.customCategory"), text: $custom)
                    }
                    if invalidCategory {
                        InlineStatusView(systemImage: "exclamationmark.octagon",
                                         message: presenter.text("row.errorCodes.category_reserved"), tone: .danger)
                    }
                }
            }
            .navigationTitle(presenter.text("ios.editDetails"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(l10n.string(.commonCancel)) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(presenter.text("row.fields.saveRow")) { save() }
                }
            }
        }
    }

    private func save() {
        let draft = CaptureDraft(description: "", amountText: "", date: CalendarDate(year: 2000, month: 1, day: 1)!,
                                 category: choice, customCategory: custom)
        guard let category = CaptureValidation.category(for: draft) else { invalidCategory = true; return }
        model.saveDetails(row, description: description.trimmingCharacters(in: .whitespacesAndNewlines), category: category)
        dismiss()
    }
}
