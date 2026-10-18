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

    // MARK: Pressed states (fills composited over the parent background, as drawn)

    /// The backgrounds a button sits on: the canvas, or a surface (a form row, a banner).
    private static let buttonParents: [ThemeColor] = [.canvas, .surface]

    private static func resolved(_ color: ThemeColor, _ appearance: ThemeAppearance) throws -> RGBA {
        try #require(ThemeTestSupport.resolve(color, in: appearance))
    }

    private static func pressedComposite(_ fill: ThemeColor, opacity: Double, over parent: ThemeColor, _ appearance: ThemeAppearance) throws -> RGBA {
        ThemeTestSupport.composite(try resolved(fill, appearance), opacity: opacity, over: try resolved(parent, appearance))
    }

    @Test(arguments: buttonParents, ThemeAppearance.allCases)
    func primaryPressedLabelMeetsAA(parent: ThemeColor, appearance: ThemeAppearance) throws {
        let fill = try Self.pressedComposite(.accentHover, opacity: OrdoPressed.primaryFillOpacity, over: parent, appearance)
        let ratio = ThemeTestSupport.contrast(try Self.resolved(.onAccent, appearance), fill)
        #expect(ratio >= 4.5, "onAccent on pressed primary over \(parent) in \(appearance.testDescription) is \(ratio)")
    }

    @Test(arguments: buttonParents, ThemeAppearance.allCases)
    func secondaryPressedFillIsVisibleAndLabelMeetsAA(parent: ThemeColor, appearance: ThemeAppearance) throws {
        let fill = try Self.pressedComposite(.border, opacity: 1, over: parent, appearance)
        let visible = ThemeTestSupport.contrast(fill, try Self.resolved(parent, appearance))
        #expect(visible >= 1.1, "pressed secondary fill over \(parent) in \(appearance.testDescription) is only \(visible)")
        let label = ThemeTestSupport.contrast(try Self.resolved(.text, appearance), fill)
        #expect(label >= 4.5, "text on pressed secondary over \(parent) in \(appearance.testDescription) is \(label)")
    }

    /// The destructive fill alone is subtle in light mode, so the documented cue is the stroke going
    /// from 1 to 2 points; the label and the stroke must stay at AA / 3:1 on the pressed fill.
    @Test(arguments: buttonParents, ThemeAppearance.allCases)
    func destructivePressedLabelAndStrokeStayLegible(parent: ThemeColor, appearance: ThemeAppearance) throws {
        let fill = try Self.pressedComposite(.dangerSoft, opacity: 1, over: parent, appearance)
        let danger = try Self.resolved(.danger, appearance)
        let label = ThemeTestSupport.contrast(danger, fill)
        #expect(label >= 4.5, "danger label on pressed destructive over \(parent) in \(appearance.testDescription) is \(label)")
        #expect(OrdoPressed.destructiveStrokeWidth >= 2)
    }

    @Test(arguments: [ThemeColor.surface, .canvas, .successSoft, .warningSoft, .infoSoft, .dangerSoft], ThemeAppearance.allCases)
    func pressedIconGlyphMeetsNonTextContrast(background: ThemeColor, appearance: ThemeAppearance) throws {
        let parent = try Self.resolved(background, appearance)
        let glyph = ThemeTestSupport.composite(try Self.resolved(.textMuted, appearance), opacity: OrdoPressed.iconGlyphOpacity, over: parent)
        let ratio = ThemeTestSupport.contrast(glyph, parent)
        #expect(ratio >= 3, "pressed icon glyph on \(background) in \(appearance.testDescription) is \(ratio)")
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
