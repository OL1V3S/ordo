import SwiftUI

/// The language control: Settings, the sign-in screen and the account screens share it.
struct LanguageChoice {
    let current: AppLanguage
    /// False while a write is on its way.
    let isEnabled: Bool
    let select: @MainActor (AppLanguage) -> Void

    @MainActor init(model: AppModel) {
        current = model.settings.language
        isEnabled = model.canChangeLanguage
        select = { [model] in model.setLanguage($0) }
    }
}

extension AppLanguage {
    var labelKey: L10nKey { self == .en ? .settingsLanguageOptionsEn : .settingsLanguageOptionsEs }
}

struct LanguageMenu: View {
    let choice: LanguageChoice
    let l10n: L10n

    var body: some View {
        Menu {
            Picker(l10n.string(.settingsLanguageLabel), selection: Binding(get: { choice.current }, set: { choice.select($0) })) {
                ForEach(AppLanguage.allCases, id: \.self) { language in
                    Text(verbatim: l10n.string(language.labelKey)).tag(language)
                }
            }
        } label: {
            Label(l10n.string(.settingsLanguageTitle), systemImage: "globe")
        }
        .accessibilityLabel(l10n.string(.settingsLanguageLabel))
        .disabled(!choice.isEnabled)
    }
}

enum SettingsPresenter {
    /// Signing out discards a waiting save, so the user is warned while it may already be saved.
    static func signOutMessage(l10n: L10n, needsCaptureWarning: Bool) -> String {
        let base = l10n.string(.authSignOutConfirmMessage)
        return needsCaptureWarning ? base + "\n\n" + l10n.string(.captureSignOutWarning) : base
    }
}

/// Appearance, language and sign-out: the Settings tab, with its own navigation stack.
/// The account email is not shown: the app does not store it.
struct SettingsView: View {
    let model: AppModel
    let l10n: L10n

    var body: some View {
        NavigationStack { form }
    }

    private var form: some View {
        Form {
            Section {
                Picker(l10n.string(.settingsAppearanceTitle),
                       selection: Binding(get: { model.settings.theme }, set: { model.settings.setTheme($0) })) {
                    ForEach(AppTheme.allCases, id: \.self) { theme in
                        Text(verbatim: l10n.string(theme.labelKey)).tag(theme)
                    }
                }
                .pickerStyle(.segmented)
            } header: {
                Text(verbatim: l10n.string(.settingsAppearanceTitle)).themedSectionHeader()
            } footer: {
                Text(verbatim: l10n.string(.settingsAppearanceHelper))
            }
            .themedRows()
            Section {
                Picker(l10n.string(.settingsLanguageLabel),
                       selection: Binding(get: { model.settings.language }, set: { model.setLanguage($0) })) {
                    ForEach(AppLanguage.allCases, id: \.self) { language in
                        Text(verbatim: l10n.string(language.labelKey)).tag(language)
                    }
                }
                .disabled(!model.canChangeLanguage)
            } header: {
                Text(verbatim: l10n.string(.settingsLanguageTitle)).themedSectionHeader()
            } footer: {
                Text(verbatim: model.canChangeLanguage
                    ? l10n.string(.settingsLanguageHelper)
                    : l10n.string(.settingsIosLanguageWaiting))
            }
            .themedRows()
            Section {
                Button(l10n.string(.commonSignOut), role: .destructive) { model.isConfirmingSignOut = true }
                    .buttonStyle(OrdoDestructiveButtonStyle())
            } header: {
                Text(verbatim: l10n.string(.settingsAccountTitle)).themedSectionHeader()
            }
            .themedButtonRow()
        }
        .themedList()
        .navigationTitle(l10n.string(.settingsTitle))
        .confirmationDialog(l10n.string(.authSignOutConfirmTitle), isPresented: Bindable(model).isConfirmingSignOut,
                            titleVisibility: .visible) {
            Button(l10n.string(.commonSignOut), role: .destructive) { Task { await model.signOut() } }
            Button(l10n.string(.commonCancel), role: .cancel) {}
        } message: {
            Text(verbatim: SettingsPresenter.signOutMessage(l10n: l10n, needsCaptureWarning: model.captureModel.needsSignOutWarning))
        }
    }
}
