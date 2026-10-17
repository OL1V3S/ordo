import SwiftUI

// MARK: - Buttons

/// The shared look of the three Ordo buttons. The system `.borderedProminent` style draws a white
/// label on the tint, which fails contrast on the dark accent (2.75:1), so the app draws its own,
/// like the web's `.button-primary` / `.button-ghost`.
private struct OrdoButtonBody: View {
    enum Kind { case primary, secondary, destructive }

    let kind: Kind
    let fullWidth: Bool
    let configuration: ButtonStyleConfiguration
    @Environment(\.isEnabled) private var isEnabled
    @ScaledMetric(relativeTo: .body) private var minHeight = Theme.Size.touchTarget

    private var pressed: Bool { configuration.isPressed }

    private var labelColor: ThemeColor {
        guard isEnabled else { return .disabledText }
        switch kind {
        case .primary: return .onAccent
        case .secondary: return .text
        case .destructive: return .danger
        }
    }

    private var fill: ThemeColor? {
        guard isEnabled else { return kind == .primary ? .disabledSurface : nil }
        switch kind {
        case .primary: return pressed ? .accentHover : .accent
        case .secondary: return pressed ? .surfaceSunken : nil
        case .destructive: return pressed ? .dangerSoft : nil
        }
    }

    private var stroke: ThemeColor? {
        guard isEnabled else { return .disabledBorder }
        switch kind {
        case .primary: return nil
        case .secondary: return .borderStrong
        case .destructive: return .danger
        }
    }

    var body: some View {
        let shape = Theme.Radius.md.shape
        configuration.label
            .font(Theme.Typography.button.font)
            .foregroundStyle(labelColor.color)
            .tint(labelColor.color)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Theme.Space.s4.points)
            .padding(.vertical, Theme.Space.s2.points)
            .frame(maxWidth: fullWidth ? CGFloat.infinity : nil, minHeight: minHeight)
            .background { if let fill { shape.fill(fill.color) } }
            .overlay { if let stroke { shape.strokeBorder(stroke.color, lineWidth: 1) } }
            .contentShape(shape)
            // The pressed fill swaps to a darker token, but with Increase Contrast `accent` already
            // equals `accentHover`, so the whole button also dims to keep the press visible.
            .opacity(pressed ? 0.85 : 1)
    }
}

/// Accent fill with the `onAccent` label. One per view.
struct OrdoPrimaryButtonStyle: ButtonStyle {
    var fullWidth = true
    func makeBody(configuration: Configuration) -> some View {
        OrdoButtonBody(kind: .primary, fullWidth: fullWidth, configuration: configuration)
    }
}

/// Transparent with a `borderStrong` stroke and a text label (the web's `.button-ghost`).
struct OrdoSecondaryButtonStyle: ButtonStyle {
    var fullWidth = true
    func makeBody(configuration: Configuration) -> some View {
        OrdoButtonBody(kind: .secondary, fullWidth: fullWidth, configuration: configuration)
    }
}

/// A `danger` label and stroke on a transparent background. Never filled: white on the dark
/// danger colour is only 2.64:1. Use with `role: .destructive`, behind a confirmation.
struct OrdoDestructiveButtonStyle: ButtonStyle {
    var fullWidth = true
    func makeBody(configuration: Configuration) -> some View {
        OrdoButtonBody(kind: .destructive, fullWidth: fullWidth, configuration: configuration)
    }
}

/// A small symbol button (dismiss, show password) with a 44-point target that scales.
struct OrdoIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        IconBody(configuration: configuration)
    }

    private struct IconBody: View {
        let configuration: ButtonStyleConfiguration
        @ScaledMetric(relativeTo: .body) private var side = Theme.Size.touchTarget

        var body: some View {
            configuration.label
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.textMuted.color)
                .frame(minWidth: side, minHeight: side)
                .contentShape(Rectangle())
                .opacity(configuration.isPressed ? 0.6 : 1)
        }
    }
}

// MARK: - Status tones

/// How a status looks: an icon, a foreground and a soft background. Direction and meaning are
/// always carried by the icon and the text too, never by colour alone.
enum StatusTone: CaseIterable, Sendable {
    case neutral, info, success, warning, danger

    /// The icon and emphasis colour.
    var foreground: ThemeColor {
        switch self {
        case .neutral: .textMuted
        case .info: .info
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        }
    }

    /// The soft fill behind banners and highlighted rows.
    var background: ThemeColor {
        switch self {
        case .neutral: .surfaceSunken
        case .info: .infoSoft
        case .success: .successSoft
        case .warning: .warningSoft
        case .danger: .dangerSoft
        }
    }

    /// The message text: muted for neutral, regular text for everything that carries a tone.
    var textColor: ThemeColor { self == .neutral ? .textMuted : .text }

    var defaultIcon: String {
        switch self {
        case .neutral, .info: "info.circle"
        case .success: "checkmark.circle"
        case .warning, .danger: "exclamationmark.triangle"
        }
    }
}

/// A rounded, softly filled message with an icon and, optionally, a trailing control.
struct StatusBanner<Accessory: View>: View {
    let tone: StatusTone
    let systemImage: String?
    let message: String
    @ViewBuilder let accessory: Accessory

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Space.s2.points) {
            Label {
                Text(verbatim: message).foregroundStyle(tone.textColor.color)
            } icon: {
                Image(systemName: systemImage ?? tone.defaultIcon).foregroundStyle(tone.foreground.color)
            }
            .font(Theme.Typography.meta.font)
            .frame(maxWidth: .infinity, alignment: .leading)
            accessory
        }
        .padding(.leading, Theme.Space.s3.points)
        .padding(.trailing, Theme.Space.s2.points)
        .padding(.vertical, Theme.Space.s2.points)
        .background(tone.background.color, in: Theme.Radius.md.shape)
    }
}

extension StatusBanner where Accessory == EmptyView {
    init(tone: StatusTone, systemImage: String? = nil, message: String) {
        self.init(tone: tone, systemImage: systemImage, message: message) { EmptyView() }
    }
}

// MARK: - Amounts

extension AmountDirection {
    /// Cash in is green, money out stays the neutral text colour. Spending is never red.
    var themeColor: ThemeColor {
        switch self {
        case .moneyIn: .amountIn
        case .moneyOut: .amountOut
        }
    }
}

// MARK: - View helpers

extension View {
    /// The canvas behind a whole screen.
    func themedCanvas() -> some View {
        background(ThemeColor.canvas.color.ignoresSafeArea())
    }

    /// An inset-grouped list on the canvas. Apply `themedRows()` to each `Section`.
    func themedList() -> some View {
        scrollContentBackground(.hidden)
            .background(ThemeColor.canvas.color)
    }

    /// Surface-filled rows with `borderSubtle` separators. Apply to a `Section`.
    func themedRows() -> some View {
        listRowBackground(ThemeColor.surface.color)
            .listRowSeparatorTint(ThemeColor.borderSubtle.color)
    }

    /// A row that holds only a button: no row fill, so the button reads as a standalone control.
    func themedButtonRow() -> some View {
        listRowBackground(Color.clear)
    }

    /// A row filled with a status tone's soft background. Neutral keeps the ordinary surface fill.
    func themedToneRow(_ tone: StatusTone) -> some View {
        listRowBackground((tone == .neutral ? ThemeColor.surface : tone.background).color)
    }

    /// Section header text: `title3` semibold in the text colour, not upper-cased.
    func themedSectionHeader() -> some View {
        font(Theme.Typography.sectionHeader.font)
            .foregroundStyle(ThemeColor.text.color)
            .textCase(nil)
    }

    /// Money: monospaced-digit semibold, trailing. The sign and the kind label carry direction;
    /// the colour only reinforces it. `nil` is neutral.
    func themedAmount(direction: AmountDirection? = nil) -> some View {
        font(Theme.Typography.amount.font)
            .foregroundStyle((direction?.themeColor ?? .text).color)
            .multilineTextAlignment(.trailing)
    }
}
