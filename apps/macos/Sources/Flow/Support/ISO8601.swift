import Foundation

/// ISO-8601 parsing/formatting helpers. The server sends timestamps like
/// "2026-07-18T16:56:57.501Z" (usually with fractional seconds).
enum ISO8601 {
    // ISO8601DateFormatter is documented thread-safe.
    nonisolated(unsafe) private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    nonisolated(unsafe) private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parse(_ s: String) -> Date? {
        fractional.date(from: s) ?? plain.date(from: s)
    }

    /// ISO-8601 with fractional seconds — the shape the server's zod
    /// `datetime({ offset: true })` validators accept back (scheduled-message
    /// recurrences send instants this way).
    static func string(from date: Date) -> String {
        fractional.string(from: date)
    }

    /// Decoding helper for a timestamp the payload promises is present, so a
    /// malformed one surfaces as a decoding error naming the field rather than
    /// a silently-nil date.
    static func parseRequired(_ s: String) throws -> Date {
        guard let date = parse(s) else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: [], debugDescription: "not an ISO-8601 timestamp: \(s)")
            )
        }
        return date
    }

    static func now() -> String {
        string(from: Date())
    }

    /// Short human display: time for today, date + time otherwise.
    static func displayTime(_ s: String) -> String {
        guard let date = parse(s) else { return "" }
        if Calendar.current.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
