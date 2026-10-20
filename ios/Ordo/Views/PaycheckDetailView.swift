import SwiftUI

/// One schedule: its facts, the deposits linked to it and the same actions as the list.
struct PaycheckDetailView: View {
    let model: PaychecksViewModel
    let profileId: String
    let presenter: PaychecksPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        List {
            if let profile = model.profile(id: profileId) {
                content(profile)
            } else {
                Section {
                    InlineStatusView(systemImage: "exclamationmark.triangle",
                                     message: l10n.string(.paychecksFeedbackErrorsPaycheckNotFound), tone: .warning)
                }
                .themedRows()
            }
        }
        .themedList()
        .themedCanvas()
        .navigationTitle(model.profile(id: profileId)?.name ?? l10n.string(.paychecksPageTitle))
        .navigationBarTitleDisplayMode(.inline)
        .modifier(PaycheckDialogs(model: model, l10n: l10n, isActive: true))
    }

    @ViewBuilder private func content(_ profile: PaycheckProfile) -> some View {
        Section {
            if model.writePhase != .idle && !model.isSheetPresented { PaychecksStatusContent(model: model, l10n: l10n) }
            if let notice = model.notice {
                StatusBanner(tone: PaychecksPresenter.noticeTone(notice), systemImage: PaychecksPresenter.noticeIcon(notice),
                             message: l10n.string(PaychecksPresenter.noticeKey(notice)))
            }
            PaycheckActionsRow(profile: profile, model: model, presenter: presenter)
        }
        .themedRows()

        Section {
            fact(.paychecksFactsSource, l10n.string(profile.isManual ? .paychecksFactsSourceManual : .paychecksFactsSourceConfirmed))
            fact(.paychecksFactsSchedule, presenter.schedule(profile.schedule))
            fact(.paychecksFactsExpectedWindow, presenter.window(before: profile.windowBeforeDays, after: profile.windowAfterDays))
            fact(.paychecksFactsLinkedDeposits, presenter.linkedCount(profile))
            fact(.paychecksFactsProfilesEvaluated, presenter.date(model.snapshot?.evaluatedOn))
            if profile.lifecycle == .active, let projection = profile.projection {
                fact(.paychecksFactsProjectionAmount, presenter.amount(projection.amount))
                fact(.paychecksFactsScheduleDate, presenter.date(projection.anchor))
                fact(.paychecksCardNextWindow, presenter.range(projection.earliest, projection.latest))
                Text(verbatim: l10n.string(.paychecksCardNotGuaranteed))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            } else {
                Text(verbatim: presenter.nextWindow(profile))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            Text(verbatim: l10n.string(.paychecksCardScheduleNote))
                .font(Theme.Typography.finePrint.font)
                .foregroundStyle(ThemeColor.textMuted.color)
        }
        .themedRows()

        Section {
            if profile.evidence.isEmpty {
                Text(verbatim: l10n.string(.paychecksEvidenceNone))
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            ForEach(profile.evidence) { evidence in
                PaycheckEvidenceRow(profile: profile, evidence: evidence, model: model, presenter: presenter)
            }
        } header: {
            Text(verbatim: l10n.string(.paychecksEvidenceLinkedHeading, presenter.linkedCount(profile)))
                .themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()
    }

    private func fact(_ key: L10nKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
            Text(verbatim: l10n.string(key))
                .font(Theme.Typography.fieldCaption.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            Text(verbatim: value)
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
        }
        .accessibilityElement(children: .combine)
    }
}
