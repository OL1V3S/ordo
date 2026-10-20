import SwiftUI

/// The colors of the cash-flow series, from existing theme tokens.
enum CashFlowSeries {
    static let paychecks = ThemeColor.accent
    static let other = ThemeColor.info
    static let spent = ThemeColor.textMuted
}

/// A decorative horizontal bar of up to two segments, scaled to fractions of its width. Hidden from
/// accessibility: the exact amounts are always shown as text.
struct CashBar: View {
    let segments: [(fraction: Double, color: ThemeColor, outlined: Bool)]

    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                    Rectangle()
                        .fill(segment.color.color)
                        .overlay { if segment.outlined { Rectangle().strokeBorder(ThemeColor.borderStrong.color, lineWidth: 1) } }
                        .frame(width: proxy.size.width * min(max(segment.fraction, 0), 1))
                }
                Spacer(minLength: 0)
            }
        }
        .frame(height: 8)
        .background(ThemeColor.surfaceSunken.color)
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }
}

/// A label and its exact value, one accessibility element.
struct CashFigureRow: View {
    let title: String
    let value: String
    var strong = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Space.s1.points))
                                                  : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        layout {
            Text(verbatim: title)
                .font(strong ? Theme.Typography.rowTitle.font : Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
            if !typeSize.isAccessibilitySize { Spacer(minLength: Theme.Space.s2.points) }
            Text(verbatim: value).themedAmount()
        }
        .accessibilityElement(children: .combine)
    }
}

/// A swatch and a label for a chart or bar series. The swatch is hidden from accessibility.
struct CashLegendItem: View {
    let title: String
    let color: ThemeColor
    var outlined = false

    var body: some View {
        HStack(spacing: Theme.Space.s2.points) {
            Rectangle().fill(color.color).frame(width: 12, height: 12)
                .overlay { if outlined { Rectangle().strokeBorder(ThemeColor.borderStrong.color, lineWidth: 1) } }
                .accessibilityHidden(true)
            Text(verbatim: title).font(Theme.Typography.meta.font).foregroundStyle(ThemeColor.text.color)
        }
    }
}

extension View {
    func cashMuted() -> some View {
        font(Theme.Typography.meta.font).foregroundStyle(ThemeColor.textMuted.color)
    }
}
