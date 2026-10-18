import SwiftUI

/// Kind and date filters. Search is the navigation bar's search field. An invalid draft is never
/// applied, so no request is made for it; the sheet shows the app's own message instead.
struct TransactionFiltersSheet: View {
    let model: TransactionsViewModel
    let l10n: L10n
    @Environment(\.dismiss) private var dismiss

    private var presenter: TransactionsPresenter { TransactionsPresenter(l10n: l10n) }
    private var timeZone: TimeZone { .current }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(l10n.string(.timelineFiltersKindLabel), selection: kindBinding) {
                        ForEach(TimelineKindFilter.allCases, id: \.self) { kind in
                            Text(verbatim: presenter.kindFilterLabel(kind)).tag(kind)
                        }
                    }
                    Picker(l10n.string(.timelineFiltersPeriodLabel), selection: periodBinding) {
                        ForEach(TimelinePeriod.allCases, id: \.self) { period in
                            Text(verbatim: l10n.string(period.labelKey)).tag(period)
                        }
                    }
                    if model.period == .custom {
                        dateRow(label: l10n.string(.timelineFiltersFromLabel), value: model.draft.from) { model.setFrom($0) }
                        dateRow(label: l10n.string(.timelineFiltersToLabel), value: model.draft.to) { model.setTo($0) }
                    }
                }
                .themedRows()

                if model.filterProblem != nil {
                    Section {
                        InlineStatusView(systemImage: "exclamationmark.triangle",
                                         message: l10n.string(.timelineFiltersInvalid), tone: .danger)
                    }
                    .themedToneRow(.danger)
                }

                if model.isFilterActive {
                    Section {
                        Button { model.clearFilters() } label: {
                            Text(verbatim: l10n.string(.timelineFiltersClear)).frame(maxWidth: .infinity)
                        }
                        .buttonStyle(OrdoSecondaryButtonStyle())
                    }
                    .themedButtonRow()
                }
            }
            .themedList()
            .navigationTitle(Text(verbatim: l10n.string(.timelineFiltersToggle)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(l10n.string(.commonClose)) { dismiss() }
                }
            }
        }
        .onChange(of: model.filterProblem) { _, problem in
            if problem != nil { AccessibilityNotification.Announcement(l10n.string(.timelineFiltersInvalid)).post() }
        }
    }

    /// A bound that is not set shows its name as a button that sets it to today.
    @ViewBuilder private func dateRow(label: String, value: CalendarDate?, set: @escaping (CalendarDate?) -> Void) -> some View {
        if let value {
            HStack {
                DatePicker(label, selection: Binding(
                    get: { CaptureDates.date(from: value, timeZone: timeZone) },
                    set: { set(CaptureDates.calendarDate(from: $0, timeZone: timeZone)) }),
                           displayedComponents: .date)
                    .environment(\.timeZone, timeZone)
                Button { set(nil) } label: { Image(systemName: "xmark.circle") }
                    .buttonStyle(OrdoIconButtonStyle())
                    .accessibilityLabel(Text(verbatim: l10n.string(.timelineFiltersRemove, label)))
            }
        } else {
            Button { set(model.today) } label: {
                Label(label, systemImage: "plus.circle")
            }
        }
    }

    private var kindBinding: Binding<TimelineKindFilter> {
        Binding(get: { model.draft.kind }, set: { model.setKind($0) })
    }

    private var periodBinding: Binding<TimelinePeriod> {
        Binding(get: { model.period }, set: { model.setPeriod($0) })
    }
}
