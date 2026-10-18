import SwiftUI

/// The state of an edit or delete that is on its way to the server or whose outcome is not known.
/// Every state has an icon or spinner plus text, never colour alone.
struct MutationStatusContent: View {
    let model: TransactionMutationViewModel
    let l10n: L10n

    var body: some View {
        switch model.phase {
        case .submitting:
            HStack(spacing: Theme.Space.s3.points) {
                ProgressView().tint(ThemeColor.accent.color)
                Text(verbatim: l10n.string(model.isDeleteFlow ? .cashInDeleteDeleting : .captureSaving))
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.text.color)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        case .uncertain:
            VStack(alignment: .leading, spacing: Theme.Space.s3.points) {
                VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                    Label {
                        Text(verbatim: l10n.string(TransactionsPresenter.uncertainTitleKey(isDelete: model.isDeleteFlow)))
                            .font(Theme.Typography.rowTitle.font)
                            .foregroundStyle(ThemeColor.text.color)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(StatusTone.warning.foreground.color)
                    }
                    Text(verbatim: l10n.string(TransactionsPresenter.uncertainMessageKey(isDelete: model.isDeleteFlow)))
                        .font(Theme.Typography.meta.font)
                        .foregroundStyle(ThemeColor.text.color)
                }
                .accessibilityElement(children: .combine)
                Button { model.retry() } label: {
                    Text(verbatim: l10n.string(.captureRetry)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoPrimaryButtonStyle())
                .disabled(!model.canRetry)
                Button { Task { await model.check() } } label: {
                    Text(verbatim: l10n.string(.transactionsCheck)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoSecondaryButtonStyle())
            }
        case .idle, .editing, .confirmingDelete:
            EmptyView()
        }
    }
}

/// The unknown or in-flight state of an edit or delete, shown over the list when its sheet is not
/// open (a delete, or an edit whose sheet was closed).
struct MutationPendingBanner: View {
    let model: TransactionMutationViewModel
    let l10n: L10n

    var body: some View {
        MutationStatusContent(model: model, l10n: l10n)
            .padding(Theme.Space.s3.points)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(StatusTone.warning.background.color, in: Theme.Radius.md.shape)
    }
}

/// The last result of an edit or delete, dismissable.
struct MutationNoticeBanner: View {
    let notice: TransactionMutationViewModel.Notice
    let l10n: L10n
    let dismiss: () -> Void

    var body: some View {
        StatusBanner(tone: tone, systemImage: icon, message: l10n.string(TransactionsPresenter.noticeKey(notice))) {
            Button(action: dismiss) { Image(systemName: "xmark") }
                .buttonStyle(OrdoIconButtonStyle())
                .accessibilityLabel(Text(verbatim: l10n.string(.commonClose)))
        }
    }

    private var tone: StatusTone {
        switch notice {
        case .updated, .deleted: .success
        case .missing: .info
        case .updatedRefreshFailed, .deletedRefreshFailed, .checkList: .warning
        }
    }

    private var icon: String {
        switch notice {
        case .updated, .deleted: "checkmark.circle"
        case .missing: "info.circle"
        case .updatedRefreshFailed, .deletedRefreshFailed, .checkList: "exclamationmark.triangle"
        }
    }
}
