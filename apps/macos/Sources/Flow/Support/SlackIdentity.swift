import Foundation

/// Slack identity helpers (spec: provider-native ids as strings; the message
/// `ts` verbatim). Kept free of model types so the share extension, which
/// compiles the connection registry but not the chat models, can use them.
enum SlackIdentity {
    /// Slack's message timestamp: seconds, a dot, six digits. An identifier,
    /// never parsed for arithmetic, never reformatted.
    static func isTs(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2, (9...11).contains(parts[0].count), parts[1].count == 6 else { return false }
        return parts.allSatisfy { $0.allSatisfy(\.isNumber) }
    }

    /// Display-only conversion; integer math on the two halves, no floating point.
    static func date(fromTs ts: String) -> Date? {
        guard isTs(ts) else { return nil }
        let parts = ts.split(separator: ".")
        guard let seconds = Int64(parts[0]), let micros = Int64(parts[1]) else { return nil }
        let ms = seconds * 1000 + micros / 1000
        return Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
    }

    /// `providerIdentity` serialization shared with the web registry:
    /// `["slack", enterpriseId-or-null, teamId, userId]`.
    static func identityString(environment: String = "slack", enterpriseId: String?, teamId: String, userId: String) -> String {
        let parts: [Any] = [environment, enterpriseId as Any? ?? NSNull(), teamId, userId]
        let data = (try? JSONSerialization.data(withJSONObject: parts, options: [.withoutEscapingSlashes])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    /// Cache key for a Slack message: connection, team, channel and the exact `ts`.
    static func messageKey(connectionId: String, teamId: String, channelId: String, ts: String) -> String? {
        guard isTs(ts) else { return nil }
        return "slack:\(connectionId):\(teamId):\(channelId):\(ts)"
    }
}
