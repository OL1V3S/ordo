import SwiftUI
import UniformTypeIdentifiers

/// The statement import, full screen over Transactions. Everything shown is what the server last
/// reported; the PDF is read into memory only and never kept.
struct ImportStatementView: View {
    let model: ImportViewModel
    let l10n: L10n
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false

    private var presenter: ImportPresenter { ImportPresenter(l10n: l10n) }

    var body: some View {
        NavigationStack {
            content
                .themedCanvas()
                .navigationTitle(presenter.panelTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(l10n.string(.commonClose)) {
                            dismiss()
                            Task { await model.close() }
                        }
                        .disabled(model.isWriting)
                    }
                }
                .task { await model.open() }
                .fileImporter(isPresented: $picking, allowedContentTypes: [.pdf]) { result in
                    if case .success(let url) = result { model.chooseFile(url) }
                }
                .sheet(item: Bindable(model).editingRow) { row in ImportRowEditSheet(model: model, row: row, presenter: presenter, l10n: l10n) }
                .safeAreaInset(edge: .bottom, spacing: 0) { if model.phase == .review { confirmBar } }
        }
        .interactiveDismissDisabled()
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .idle, .loading:
            progress(presenter.text("panel.loadingPreview"))
        case .loadFailed:
            StatusMessageView(systemImage: "exclamationmark.triangle", message: presenter.text("fallbackErrors.load"),
                              tone: .warning, retryTitle: presenter.text("links.retry")) { Task { await model.load() } }
        case .uploading:
            VStack(spacing: Theme.Space.s3.points) {
                progress(presenter.text("panel.processing"))
                Button(l10n.string(.commonCancel)) { model.cancelUpload() }.buttonStyle(OrdoSecondaryButtonStyle(fullWidth: false))
            }
        case .empty:
            VStack(spacing: Theme.Space.s4.points) {
                Text(verbatim: presenter.text("ios.intro")).font(Theme.Typography.body.font).foregroundStyle(ThemeColor.text.color)
                messageBanner
                Button(presenter.text("dropzone.choosePdf")) { picking = true }
                    .buttonStyle(OrdoPrimaryButtonStyle())
                    .disabled(!model.canChooseFile)
                Spacer()
            }.padding()
        case .review:
            reviewList
        case .completed:
            VStack(spacing: Theme.Space.s4.points) {
                if let completion = model.completion {
                    StatusMessageView(systemImage: "checkmark.circle", message: presenter.completionTitle(completion) + "\n" + presenter.completionText(completion), tone: .success)
                }
                Button(l10n.string(.commonClose)) { dismiss(); Task { await model.close() } }
                    .buttonStyle(OrdoSecondaryButtonStyle(fullWidth: false))
                Spacer()
            }.padding()
        }
    }

    private func progress(_ text: String) -> some View {
        VStack(spacing: Theme.Space.s3.points) {
            ProgressView()
            Text(verbatim: text).font(Theme.Typography.body.font).foregroundStyle(ThemeColor.text.color)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).padding()
    }

    @ViewBuilder private var messageBanner: some View {
        if let message = model.message {
            InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.messageText(message), tone: .warning)
                .accessibilityAddTraits(.isStaticText)
        }
    }

    // MARK: Review

    private var reviewList: some View {
        List {
            Section {
                messageBanner
                if model.rowWrite?.phase == .uncertain {
                    uncertainPanel(presenter.text("ios.uncertainRow"), retry: model.canRetryRow ? { model.retryRow() } : nil)
                }
                if model.confirmPhase == .uncertain {
                    uncertainPanel(presenter.text("ios.uncertainConfirm"), retry: model.canRetryConfirm ? { model.retryConfirm() } : nil)
                }
                if model.needsReload || model.rowWrite?.phase == .uncertain {
                    Button(presenter.text("ios.reload")) { Task { await model.reload() } }
                        .disabled(!model.canReload)
                }
                Text(verbatim: presenter.text("panel.notice")).font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
                Text(verbatim: presenter.expiryMeta(rows: model.summary.total, expiresAt: model.preview?.expiresAt))
                    .font(Theme.Typography.meta.font).foregroundStyle(ThemeColor.textMuted.color)
            }.themedRows()
            summarySection
            Section {
                Picker(presenter.text("filters.legend"), selection: Binding(get: { model.filter }, set: { model.setFilter($0) })) {
                    ForEach(ImportFilter.allCases, id: \.self) { filter in
                        Text(verbatim: presenter.filterLabel(filter, count: model.filterCounts[filter] ?? 0)).tag(filter)
                    }
                }
                Button(presenter.string("bulk.selectAll", String(model.bulkSelectableCount))) { model.selectEligibleExpenses() }
                    .disabled(!model.canEdit || model.bulkSelectableCount == 0)
                Button(presenter.text("bulk.clear")) { model.clearSelection() }
                    .disabled(!model.canEdit || ImportReviewRules.bulkClearTargets(model.rows).isEmpty)
                Text(verbatim: presenter.text("bulk.hint")).font(Theme.Typography.meta.font).foregroundStyle(ThemeColor.textMuted.color)
            }.themedRows()
            Section {
                if model.visibleRows.isEmpty {
                    Text(verbatim: presenter.text("filters.empty")).font(Theme.Typography.meta.font)
                } else {
                    Text(verbatim: presenter.showing(shown: model.visibleRows.count, total: model.reviewRows.count))
                        .font(Theme.Typography.meta.font).foregroundStyle(ThemeColor.textMuted.color)
                    ForEach(model.visibleRows) { row in
                        ImportRowView(model: model, row: row, presenter: presenter) { model.editingRow = row }
                    }
                }
                if model.unreadableCount > 0 {
                    VStack(alignment: .leading) {
                        Text(verbatim: presenter.plural("unreadable.summary", model.unreadableCount)).font(Theme.Typography.body.font)
                        Text(verbatim: presenter.text("unreadable.note")).font(Theme.Typography.meta.font)
                            .foregroundStyle(ThemeColor.textMuted.color)
                    }
                }
            }.themedRows()
        }
        .themedList()
    }

    private var summarySection: some View {
        let summary = model.summary
        return Section(header: Text(verbatim: presenter.text("summary.heading"))) {
            summaryRow("summary.expensesSelected", summary.expensesSelected)
            summaryRow("summary.depositsSelected", summary.depositsSelected)
            summaryRow("summary.possibleDuplicates", summary.possibleDuplicates)
            summaryRow("summary.needsReview", summary.needsReview)
            summaryRow("summary.cannotBeSelected", summary.cannotBeSelected)
        }.themedRows()
    }

    private func summaryRow(_ path: String, _ value: Int) -> some View {
        HStack {
            Text(verbatim: presenter.text(path))
            Spacer()
            Text(verbatim: String(value)).monospacedDigit()
        }.font(Theme.Typography.body.font)
    }

    private func uncertainPanel(_ text: String, retry: (() -> Void)?) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
            InlineStatusView(systemImage: "questionmark.circle", message: presenter.text("ios.uncertainTitle"), tone: .warning)
            Text(verbatim: text).font(Theme.Typography.body.font)
            Button(presenter.text("links.retry")) { retry?() }
                .buttonStyle(OrdoSecondaryButtonStyle(fullWidth: false))
                .disabled(retry == nil)
        }
    }

    private var confirmBar: some View {
        let totals = model.totals
        return VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
            Text(verbatim: presenter.expensesBar(totals)).font(Theme.Typography.meta.font)
            Text(verbatim: presenter.depositsBar(totals)).font(Theme.Typography.meta.font)
            Button(presenter.saveTitle(totals, saving: model.confirmPhase == .submitting)) { model.confirm() }
                .buttonStyle(OrdoPrimaryButtonStyle())
                .disabled(!model.canConfirm)
        }
        .padding()
        .background(ThemeColor.surface.color)
    }
}
