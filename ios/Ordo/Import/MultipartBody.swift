import Foundation

/// The upload body. The file part always carries the fixed name `statement.pdf`; the name of the
/// user's file is never read or sent.
enum MultipartBody {
    static let fileName = "statement.pdf"
    static let sourceType = "sunflower_pdf"

    static func make(pdf: Data, boundary: String = UUID().uuidString) -> ImportUploadBody {
        var data = Data()
        func add(_ text: String) { data.append(Data(text.utf8)) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"sourceType\"\r\n\r\n\(sourceType)\r\n")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n")
        add("Content-Type: application/pdf\r\n\r\n")
        data.append(pdf)
        add("\r\n--\(boundary)--\r\n")
        return ImportUploadBody(boundary: boundary, data: data)
    }
}
