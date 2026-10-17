import Foundation
@testable import Ordo

private final class BundleToken {}

enum Fixtures {
    /// Finds a synthetic fixture by name anywhere inside the test bundle.
    static func data(_ name: String) throws -> Data {
        let root = Bundle(for: BundleToken.self).bundleURL
        let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)
        while let url = enumerator?.nextObject() as? URL {
            if url.lastPathComponent == "\(name).json" { return try Data(contentsOf: url) }
        }
        throw CocoaError(.fileNoSuchFile)
    }

    static func snapshot(_ name: String) throws -> HomeSnapshot {
        try HomeValidation.parse(try data(name))
    }
}
