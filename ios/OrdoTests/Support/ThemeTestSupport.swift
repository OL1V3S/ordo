import Foundation
import SwiftUI
import Testing
import UIKit
@testable import Ordo

/// One of the four appearances a theme colour is resolved in.
struct ThemeAppearance: Sendable, CaseIterable, CustomTestStringConvertible {
    let dark: Bool
    let highContrast: Bool

    static let allCases: [ThemeAppearance] = [
        ThemeAppearance(dark: false, highContrast: false), ThemeAppearance(dark: true, highContrast: false),
        ThemeAppearance(dark: false, highContrast: true), ThemeAppearance(dark: true, highContrast: true),
    ]

    var testDescription: String { "\(dark ? "dark" : "light")\(highContrast ? " + increased contrast" : "")" }

    var traits: UITraitCollection {
        UITraitCollection(traitsFrom: [
            UITraitCollection(userInterfaceStyle: dark ? .dark : .light),
            UITraitCollection(accessibilityContrast: highContrast ? .high : .normal),
        ])
    }

    /// The same appearance without Increase Contrast.
    var base: ThemeAppearance { ThemeAppearance(dark: dark, highContrast: false) }
}

struct RGBA: Equatable, Sendable {
    let red: Int, green: Int, blue: Int
    let alpha: Double

    var hex: Int { (red << 16) | (green << 8) | blue }
}

enum ThemeTestSupport {
    /// Resolves a catalog colour in an appearance, straight from the asset catalog.
    static func resolve(_ color: ThemeColor, in appearance: ThemeAppearance) -> RGBA? {
        guard let ui = UIColor(named: color.assetName, in: Theme.bundle, compatibleWith: appearance.traits) else { return nil }
        // Resolving against the traits picks the right appearance variant of the asset.
        let resolved = ui.resolvedColor(with: appearance.traits)
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return nil }
        func byte(_ value: CGFloat) -> Int { Int((value * 255).rounded()) }
        return RGBA(red: byte(red), green: byte(green), blue: byte(blue), alpha: Double(alpha))
    }

    /// WCAG relative luminance of an sRGB colour.
    static func luminance(_ color: RGBA) -> Double {
        func channel(_ value: Int) -> Double {
            let c = Double(value) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
    }

    /// WCAG contrast ratio, from 1 to 21.
    static func contrast(_ a: RGBA, _ b: RGBA) -> Double {
        let la = luminance(a), lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    /// A colour drawn at `opacity` over an opaque background, as SwiftUI composites a dimmed fill.
    static func composite(_ foreground: RGBA, opacity: Double, over background: RGBA) -> RGBA {
        func mix(_ top: Int, _ bottom: Int) -> Int { Int((Double(top) * opacity + Double(bottom) * (1 - opacity)).rounded()) }
        return RGBA(red: mix(foreground.red, background.red), green: mix(foreground.green, background.green),
                    blue: mix(foreground.blue, background.blue), alpha: 1)
    }
}
