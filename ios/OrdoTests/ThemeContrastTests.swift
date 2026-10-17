import Foundation
import Testing
@testable import Ordo

/// WCAG checks over every foreground/background pair the theme styles and views compose,
/// resolved from the asset catalog in all four appearances.
@Suite struct ThemeContrastTests {
    struct Pair: Sendable, CustomTestStringConvertible {
        let foreground: ThemeColor
        let background: ThemeColor
        /// 4.5 for text, 3 for non-text (strokes, glyphs).
        let minimum: Double
        var testDescription: String { "\(foreground) on \(background) (>= \(minimum))" }
    }

    private static func text(_ foreground: ThemeColor, _ backgrounds: [ThemeColor]) -> [Pair] {
        backgrounds.map { Pair(foreground: foreground, background: $0, minimum: 4.5) }
    }

    static let pairs: [Pair] = {
        var pairs: [Pair] = []
        // Body text and muted text on every surface they sit on.
        pairs += text(.text, [.canvas, .surface, .surfaceRaised, .surfaceSunken])
        pairs += text(.textMuted, [.canvas, .surface, .surfaceRaised, .surfaceSunken])
        pairs += text(.amountOut, [.canvas, .surface])
        pairs += text(.amountIn, [.canvas, .surface])
        // Accent text and the primary button, including its pressed fill.
        pairs += text(.accent, [.canvas, .surface])
        pairs += text(.onAccent, [.accent, .accentHover])
        // Secondary and destructive buttons, including their pressed fills.
        pairs += text(.danger, [.canvas, .surface, .dangerSoft])
        pairs += text(.disabledText, [.disabledSurface])
        // Every status tone: icon/emphasis on the surfaces it sits on, and the message text on
        // the tone's own soft background.
        for tone in StatusTone.allCases {
            pairs += text(tone.foreground, [.canvas, .surface, tone.background])
            pairs += text(tone.textColor, [tone.background])
            pairs += text(.text, [tone.background])
            pairs += text(.textMuted, [tone.background])
        }
        // Non-text: control strokes and the accent glyph.
        pairs += [
            Pair(foreground: .borderStrong, background: .surface, minimum: 3),
            Pair(foreground: .borderStrong, background: .canvas, minimum: 3),
            Pair(foreground: .accent, background: .surface, minimum: 3),
            Pair(foreground: .danger, background: .canvas, minimum: 3),
        ]
        return pairs
    }()

    private static func ratio(_ pair: Pair, _ appearance: ThemeAppearance) throws -> Double {
        let fg = try #require(ThemeTestSupport.resolve(pair.foreground, in: appearance))
        let bg = try #require(ThemeTestSupport.resolve(pair.background, in: appearance))
        return ThemeTestSupport.contrast(fg, bg)
    }

    @Test(arguments: pairs, ThemeAppearance.allCases)
    func pairMeetsItsMinimum(pair: Pair, appearance: ThemeAppearance) throws {
        let ratio = try Self.ratio(pair, appearance)
        #expect(ratio >= pair.minimum, "\(pair.testDescription) in \(appearance.testDescription) is \(ratio)")
    }

    @Test(arguments: pairs, [ThemeAppearance(dark: false, highContrast: true), ThemeAppearance(dark: true, highContrast: true)])
    func increasedContrastIsNeverLowerThanBase(pair: Pair, appearance: ThemeAppearance) throws {
        let high = try Self.ratio(pair, appearance)
        let base = try Self.ratio(pair, appearance.base)
        #expect(high >= base - 0.005, "\(pair.testDescription) in \(appearance.testDescription): \(high) < \(base)")
    }

    // MARK: The contrast function itself

    @Test func blackOnWhiteIs21() {
        let black = RGBA(red: 0, green: 0, blue: 0, alpha: 1), white = RGBA(red: 255, green: 255, blue: 255, alpha: 1)
        #expect(abs(ThemeTestSupport.contrast(black, white) - 21) < 0.0001)
        #expect(abs(ThemeTestSupport.contrast(white, black) - 21) < 0.0001)
        #expect(abs(ThemeTestSupport.contrast(white, white) - 1) < 0.0001)
    }

    @Test func knownMidGrayValue() {
        // #777777 on white is the classic 4.48:1 (just under AA).
        let gray = RGBA(red: 0x77, green: 0x77, blue: 0x77, alpha: 1), white = RGBA(red: 255, green: 255, blue: 255, alpha: 1)
        #expect(abs(ThemeTestSupport.contrast(gray, white) - 4.48) < 0.01)
    }

    @Test func publishedRatiosMatch() throws {
        func ratio(_ fg: ThemeColor, _ bg: ThemeColor, dark: Bool) throws -> Double {
            try Self.ratio(Pair(foreground: fg, background: bg, minimum: 0), ThemeAppearance(dark: dark, highContrast: false))
        }
        #expect(abs(try ratio(.text, .canvas, dark: false) - 15.91) < 0.01)
        #expect(abs(try ratio(.onAccent, .accent, dark: true) - 6.91) < 0.01)
        #expect(abs(try ratio(.borderStrong, .surface, dark: false) - 3.31) < 0.01)
    }
}
