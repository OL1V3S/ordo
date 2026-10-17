import Foundation
import Testing
import UIKit
@testable import Ordo

@Suite struct ThemeColorTests {
    /// The values in docs/design-tokens.md (iOS section): light, dark, and the Increase Contrast
    /// pair where the web palette offers a stronger value (otherwise the base values apply).
    private struct Expected {
        let light: Int, dark: Int
        var lightHC: Int? = nil, darkHC: Int? = nil
    }

    private static let expected: [ThemeColor: Expected] = [
        .canvas: Expected(light: 0xF5F5F1, dark: 0x0D1017),
        .surface: Expected(light: 0xFFFFFF, dark: 0x151923),
        .surfaceRaised: Expected(light: 0xFAFAF7, dark: 0x1C2130),
        .surfaceSunken: Expected(light: 0xF5F5F1, dark: 0x1C2130),
        .borderSubtle: Expected(light: 0xE7E8EC, dark: 0x242938, lightHC: 0x8B8D94, darkHC: 0x666C7D),
        .border: Expected(light: 0xDEDFE2, dark: 0x2B3040, lightHC: 0x8B8D94, darkHC: 0x666C7D),
        .borderStrong: Expected(light: 0x8B8D94, dark: 0x666C7D, lightHC: 0x666873, darkHC: 0xA1A4AD),
        .text: Expected(light: 0x181A20, dark: 0xF3F3F0),
        .textMuted: Expected(light: 0x666873, dark: 0xA1A4AD, lightHC: 0x181A20, darkHC: 0xF3F3F0),
        .accent: Expected(light: 0x5458C9, dark: 0x8D91FF, lightHC: 0x4549AE, darkHC: 0xA5A8FF),
        .accentHover: Expected(light: 0x4549AE, dark: 0xA5A8FF),
        .onAccent: Expected(light: 0xFFFFFF, dark: 0x0D1017),
        .amountIn: Expected(light: 0x087A55, dark: 0x55D6A6),
        .disabledText: Expected(light: 0x62667F, dark: 0xB1B5D2),
        .disabledSurface: Expected(light: 0xEEEFFA, dark: 0x262C40),
        .disabledBorder: Expected(light: 0x8B8D94, dark: 0x666C7D),
        .danger: Expected(light: 0xC4324B, dark: 0xFF7187),
        .dangerSoft: Expected(light: 0xFFF0F3, dark: 0x351923),
        .warning: Expected(light: 0x9A5B00, dark: 0xFFC15C),
        .warningSoft: Expected(light: 0xFFF6DF, dark: 0x302510),
        .success: Expected(light: 0x087A55, dark: 0x55D6A6),
        .successSoft: Expected(light: 0xE8F8F1, dark: 0x102A23),
        .info: Expected(light: 0x566A7A, dark: 0x91AAB9),
        .infoSoft: Expected(light: 0xEDF2F5, dark: 0x1B272E),
    ]

    @Test func theTableCoversEveryColor() {
        #expect(Set(Self.expected.keys) == Set(ThemeColor.allCases))
    }

    @Test(arguments: ThemeColor.allCases) func everyColorExistsInTheCatalog(color: ThemeColor) {
        #expect(UIColor(named: color.assetName, in: Theme.bundle, compatibleWith: nil) != nil, "missing asset \(color.assetName)")
    }

    @Test(arguments: ThemeColor.allCases, ThemeAppearance.allCases)
    func everyColorResolvesOpaqueInEveryAppearance(color: ThemeColor, appearance: ThemeAppearance) throws {
        let rgba = try #require(ThemeTestSupport.resolve(color, in: appearance))
        #expect(rgba.alpha == 1)
    }

    @Test(arguments: ThemeColor.allCases, ThemeAppearance.allCases)
    func resolvedValuesMatchTheDocumentedTable(color: ThemeColor, appearance: ThemeAppearance) throws {
        let row = try #require(Self.expected[color])
        let rgba = try #require(ThemeTestSupport.resolve(color, in: appearance))
        let want: Int
        switch (appearance.dark, appearance.highContrast) {
        case (false, false): want = row.light
        case (true, false): want = row.dark
        case (false, true): want = row.lightHC ?? row.light
        case (true, true): want = row.darkHC ?? row.dark
        }
        #expect(rgba.hex == want, "\(color) in \(appearance.testDescription): \(String(rgba.hex, radix: 16)) != \(String(want, radix: 16))")
    }

    @Test func amountOutIsTheTextColor() {
        #expect(ThemeColor.amountOut == .text)
    }

    @Test func accentIsTheGlobalAccentColorAsset() {
        #expect(ThemeColor.accent.assetName == "AccentColor")
    }

    /// The compiled catalog cannot be listed at runtime, so the colour sets are read from the
    /// source tree and compared with the Swift cases.
    @Test func theColorsetFoldersMatchTheSwiftCases() throws {
        let catalog = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Ordo/Resources/Assets.xcassets", isDirectory: true)
        let themeDirectory = catalog.appendingPathComponent("Theme", isDirectory: true)
        let entries = try FileManager.default.contentsOfDirectory(atPath: themeDirectory.path)
        let folders = Set(entries.filter { $0.hasSuffix(".colorset") }.map { String($0.dropLast(".colorset".count)) })
        #expect(!folders.isEmpty, "no colour sets found at \(themeDirectory.path)")
        let cases = Set(ThemeColor.allCases.filter { $0 != .accent }.map(\.rawValue))
        #expect(folders == cases)
        #expect(FileManager.default.fileExists(atPath: catalog.appendingPathComponent("AccentColor.colorset/Contents.json").path))
    }
}
