import SwiftUI
import UIKit

/// Finds the app bundle that holds the asset catalog, even when the code runs inside the
/// hosted test bundle (where `Bundle.main` is not the app).
private final class ThemeBundleToken {}

/// The Ordo look: the web's semantic colours, type scale, radii and spacing, in one place.
/// Views never use raw colours; they read these tokens. See `docs/design-tokens.md`.
enum Theme {
    static let bundle = Bundle(for: ThemeBundleToken.self)

    // MARK: Spacing (web `--space-1` ... `--space-8`)

    enum Space: CaseIterable, Sendable {
        case s1, s2, s3, s4, s5, s6, s7, s8

        var points: CGFloat {
            switch self {
            case .s1: 4
            case .s2: 8
            case .s3: 12
            case .s4: 16
            case .s5: 24
            case .s6: 32
            case .s7: 48
            case .s8: 64
            }
        }
    }

    // MARK: Radius (web `--radius-*`, continuous corners)

    enum Radius: CaseIterable, Sendable {
        case xs, sm, md, lg, pill

        /// Corner radius in points. `pill` is larger than any control height here.
        var points: CGFloat {
            switch self {
            case .xs: 4
            case .sm: 6
            case .md: 8
            case .lg: 12
            case .pill: 999
            }
        }

        var shape: RoundedRectangle { RoundedRectangle(cornerRadius: points, style: .continuous) }
    }

    // MARK: Sizes

    enum Size {
        /// The minimum touch target, in points (web `--size-touch-target`, Apple's 44 x 44).
        static let touchTarget: CGFloat = 44
    }

    // MARK: Typography

    /// The web's type scale mapped to iOS text styles, so everything follows Dynamic Type.
    /// There is no custom font and no fixed point size.
    enum Typography: CaseIterable, Sendable {
        /// 3xl / display: the system navigation title.
        case largeTitle
        /// 2xl (reserved for later screens).
        case title
        /// xl (reserved for later screens).
        case title2
        /// lg: section headers.
        case sectionHeader
        /// base, semibold: row titles.
        case rowTitle
        /// base: row text and field text.
        case body
        /// sm: meta text.
        case meta
        /// sm: fine print.
        case finePrint
        /// xs: row meta lines.
        case caption
        /// xs, semibold: field captions and kind labels.
        case fieldCaption
        /// base, semibold, monospaced digits: money.
        case amount
        /// base, semibold: button labels (the web's bold, mapped to semibold).
        case button

        var textStyle: Font.TextStyle {
            switch self {
            case .largeTitle: .largeTitle
            case .title: .title
            case .title2: .title2
            case .sectionHeader: .title3
            case .rowTitle: .headline
            case .body, .amount, .button: .body
            case .meta: .subheadline
            case .finePrint: .footnote
            case .caption, .fieldCaption: .caption
            }
        }

        /// `nil` means the text style's own weight.
        var weight: Font.Weight? {
            switch self {
            case .sectionHeader, .fieldCaption, .amount, .button: .semibold
            case .largeTitle, .title, .title2, .rowTitle, .body, .meta, .finePrint, .caption: nil
            }
        }

        var usesMonospacedDigits: Bool { self == .amount }

        var font: Font {
            var font = Font.system(textStyle)
            if let weight { font = font.weight(weight) }
            if usesMonospacedDigits { font = font.monospacedDigit() }
            return font
        }
    }
}

/// The semantic colours ported from the web's `themes.css`, each with a light and a dark value
/// (and an Increase Contrast variant where the web palette offers a stronger one). The asset
/// catalog holds the values; this enum is the only way views reach them.
enum ThemeColor: String, CaseIterable, Sendable {
    case canvas, surface, surfaceRaised, surfaceSunken
    case borderSubtle, border, borderStrong
    case text, textMuted
    case accent, accentHover, onAccent
    case amountIn
    case disabledText, disabledSurface, disabledBorder
    case danger, dangerSoft, warning, warningSoft, success, successSoft, info, infoSoft

    /// The web's `amount-out` is the body text colour: spending is never red.
    static var amountOut: ThemeColor { .text }

    /// The asset catalog name. `accent` is the global `AccentColor`; the rest are namespaced.
    var assetName: String { self == .accent ? "AccentColor" : "Theme/\(rawValue)" }

    var color: Color { Color(assetName, bundle: Theme.bundle) }

    /// Resolves the catalog colour; used by tests and anything that needs a `UIColor`.
    var uiColor: UIColor {
        // A missing asset is caught by `ThemeColorTests`; magenta makes it obvious if one slips by.
        UIColor(named: assetName, in: Theme.bundle, compatibleWith: nil) ?? .magenta
    }
}
