import SwiftUI
import Testing
@testable import Ordo

@Suite struct ThemeScaleTests {
    @Test func spacingMapsTheWebScale() {
        #expect(Theme.Space.allCases.map(\.points) == [4, 8, 12, 16, 24, 32, 48, 64])
    }

    @Test func radiiMapTheWebScale() {
        #expect(Theme.Radius.allCases.count == 5)
        #expect([Theme.Radius.xs, .sm, .md, .lg].map(\.points) == [4, 6, 8, 12])
        #expect(Theme.Radius.pill.points > Theme.Radius.lg.points)
    }

    @Test func touchTargetIsFortyFourPoints() {
        #expect(Theme.Size.touchTarget == 44)
    }

    @Test func everyTypeRoleMapsToATextStyle() {
        let expected: [Theme.Typography: Font.TextStyle] = [
            .largeTitle: .largeTitle, .title: .title, .title2: .title2, .sectionHeader: .title3,
            .rowTitle: .headline, .body: .body, .meta: .subheadline, .finePrint: .footnote,
            .caption: .caption, .fieldCaption: .caption, .amount: .body, .button: .body,
        ]
        #expect(Set(expected.keys) == Set(Theme.Typography.allCases))
        for role in Theme.Typography.allCases {
            #expect(role.textStyle == expected[role], "\(role)")
        }
    }

    @Test func weightsFollowThePlan() {
        for role in Theme.Typography.allCases {
            switch role {
            case .sectionHeader, .fieldCaption, .amount, .button: #expect(role.weight == .semibold, "\(role)")
            default: #expect(role.weight == nil, "\(role)")
            }
        }
    }

    @Test func onlyAmountsUseMonospacedDigits() {
        for role in Theme.Typography.allCases { #expect(role.usesMonospacedDigits == (role == .amount), "\(role)") }
    }

    @Test func everyStatusToneHasAnIconAndColours() {
        for tone in StatusTone.allCases {
            #expect(!tone.defaultIcon.isEmpty)
            #expect(tone.foreground != tone.background)
        }
    }

    @Test func amountDirectionColours() {
        #expect(AmountDirection.moneyIn.themeColor == .amountIn)
        #expect(AmountDirection.moneyOut.themeColor == .amountOut)
        #expect(AmountDirection.moneyOut.themeColor == .text)
    }
}
