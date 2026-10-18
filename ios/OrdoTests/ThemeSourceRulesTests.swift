import Foundation
import Testing

/// Views never use raw colours, system colours, fixed font sizes or system button styles: they go
/// through the theme layer. This mirrors the web's `tokenLiterals.test.js`.
@Suite struct ThemeSourceRulesTests {
    private static let systemColors = "red|blue|green|orange|yellow|pink|purple|brown|cyan|mint|teal|indigo|gray|grey|white|black|primary|secondary|tertiary|quaternary"

    private static let rules: [(name: String, pattern: String)] = [
        ("Color( literal", #"\bColor\("#),
        ("UIColor", #"\bUIColor\b"#),
        (".foregroundColor(", #"\.foregroundColor\("#),
        ("Color.<system colour>", #"\bColor\.(\#(systemColors))\b"#),
        ("system colour as a style",
         #"\.(foregroundStyle|background|tint|fill|stroke|strokeBorder|overlay|accentColor|listRowBackground|listRowSeparatorTint)\(\s*\.(\#(systemColors))\b"#),
        (".font(.system(size:", #"\.font\(\s*\.system\(\s*size:"#),
        ("system bordered button style", #"\.buttonStyle\(\s*\.border"#),
    ]

    /// Returns a description of each rule a source text breaks (comments are ignored).
    static func violations(in source: String) -> [String] {
        let code = source.split(separator: "\n", omittingEmptySubsequences: false).map { line -> String in
            if let range = line.range(of: "//") { return String(line[..<range.lowerBound]) }
            return String(line)
        }.joined(separator: "\n")
        var found: [String] = []
        for rule in rules {
            guard let regex = try? NSRegularExpression(pattern: rule.pattern) else {
                found.append("invalid rule \(rule.name)")
                continue
            }
            if regex.firstMatch(in: code, range: NSRange(code.startIndex..., in: code)) != nil { found.append(rule.name) }
        }
        return found
    }

    private static var viewsDirectory: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Ordo/Views", isDirectory: true)
    }

    @Test func viewsUseOnlyTheTheme() throws {
        let files = try FileManager.default.contentsOfDirectory(atPath: Self.viewsDirectory.path).filter { $0.hasSuffix(".swift") }
        #expect(!files.isEmpty, "no Swift files found in \(Self.viewsDirectory.path)")
        for file in files.sorted() {
            let source = try String(contentsOf: Self.viewsDirectory.appendingPathComponent(file), encoding: .utf8)
            #expect(Self.violations(in: source).isEmpty, "\(file): \(Self.violations(in: source))")
        }
    }

    @Test(arguments: [
        "Text(\"x\").foregroundColor(.red)",
        "let c = Color(red: 1, green: 0, blue: 0)",
        "let c = UIColor.red",
        "Text(\"x\").foregroundStyle(.secondary)",
        "Text(\"x\").foregroundStyle( .red )",
        "view.background(.white)",
        "view.tint(Color.blue)",
        "Text(\"x\").font(.system(size: 14))",
        "Button(\"x\") {}.buttonStyle(.borderedProminent)",
        "Button(\"x\") {}.buttonStyle(.bordered)",
    ]) func theScanFlagsRawStyling(source: String) {
        #expect(!Self.violations(in: source).isEmpty, "\(source)")
    }

    @Test(arguments: [
        "Text(\"x\").foregroundStyle(ThemeColor.text.color)",
        "listRowBackground(Color.clear)",
        "// a comment about .foregroundStyle(.secondary) and Color(red: 1)",
        "Text(\"x\").font(Theme.Typography.body.font)",
        "Button(\"x\") {}.buttonStyle(OrdoPrimaryButtonStyle())",
    ]) func theScanAllowsThemedStyling(source: String) {
        #expect(Self.violations(in: source).isEmpty, "\(source)")
    }
}
