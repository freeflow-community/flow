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

    static func now() -> String {
        fractional.string(from: Date())
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
