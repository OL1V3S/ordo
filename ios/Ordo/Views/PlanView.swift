import SwiftUI

/// The three areas of the Plan tab, in the web's Plan hub order.
enum PlanSection: String, CaseIterable, Identifiable, Sendable {
    case budgets, recurring, paychecks

    var id: String { rawValue }

    /// The same labels as the web's Plan hub and navigation.
    var labelKey: L10nKey {
        switch self {
        case .budgets: .navigationDestinationsBudgets
        case .recurring: .commitmentsPageTitle
        case .paychecks: .navigationDestinationsPaychecks
        }
    }
}

/// When the Plan switcher can be used and how it looks. The switcher is added to an area's root
/// screen only, so a pushed screen never has it.
enum PlanSwitcherRules {
    enum Style: Equatable { case segmented, menu }

    /// Off while a write is in flight, so switching cannot tear down a screen that is saving.
    static func isEnabled(writeInFlight: Bool) -> Bool { !writeInFlight }

    /// A menu at accessibility text sizes, where the labels do not fit side by side.
    static func style(isAccessibilitySize: Bool) -> Style { isAccessibilitySize ? .menu : .segmented }
}

/// The Plan tab: Budgets, Recurring expenses and Paychecks, as the web's Plan hub. Each area keeps
/// its own navigation stack and shows the switcher under its navigation bar on its root screen
/// only. Switching rebuilds the area: its data and drafts live in `AppModel`, but a pushed screen,
/// open groups and scroll position start over.
struct PlanView: View {
    let model: AppModel
    let l10n: L10n
    @State private var section: PlanSection = .budgets

    var body: some View {
        switch section {
        case .budgets:
            BudgetsView(model: model.budgetsModel, l10n: l10n, planSection: $section, planSwitchEnabled: PlanSwitcherRules.isEnabled(writeInFlight: model.isWriteInFlight))
        case .recurring:
            RecurringView(model: model.recurringModel, l10n: l10n, planSection: $section, planSwitchEnabled: PlanSwitcherRules.isEnabled(writeInFlight: model.isWriteInFlight))
        case .paychecks:
            PaychecksView(model: model.paychecksModel, l10n: l10n, planSection: $section, planSwitchEnabled: PlanSwitcherRules.isEnabled(writeInFlight: model.isWriteInFlight))
        }
    }
}

/// Budgets / Recurring expenses / Paychecks. Segments, or a menu at accessibility text sizes where
/// the labels do not fit side by side.
struct PlanSwitcher: View {
    @Binding var selection: PlanSection
    let isEnabled: Bool
    let l10n: L10n
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let label = l10n.string(.navigationHubsPlanAriaLabel)
        Group {
            switch PlanSwitcherRules.style(isAccessibilitySize: dynamicTypeSize.isAccessibilitySize) {
            case .menu: picker(label).pickerStyle(.menu)
            case .segmented: picker(label).pickerStyle(.segmented)
            }
        }
        .disabled(!isEnabled)
        .padding(.horizontal, Theme.Space.s4.points)
        .padding(.vertical, Theme.Space.s2.points)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ThemeColor.canvas.color)
    }

    private func picker(_ label: String) -> some View {
        Picker(label, selection: $selection) {
            ForEach(PlanSection.allCases) { section in
                Text(verbatim: l10n.string(section.labelKey)).tag(section)
            }
        }
    }
}

extension View {
    /// The Plan switcher as a top inset of an area's root screen (a pushed screen does not get it).
    func planSwitcher(_ selection: Binding<PlanSection>, isEnabled: Bool, l10n: L10n) -> some View {
        safeAreaInset(edge: .top, spacing: 0) {
            PlanSwitcher(selection: selection, isEnabled: isEnabled, l10n: l10n)
        }
    }
}
