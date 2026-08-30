import Foundation

/// Scheduled messages (#419/#420/#424) — the native mirror of the server's
/// `ScheduledMessageDTO`. Compiled into both the macOS app and the iOS app
/// (`apps/ios/project.yml` pulls this whole directory in), so the two clients
/// cannot drift on what a schedule *is* or how it reads.
///
/// Not a GRDB record: the list is small, per-workspace and always fetched fresh
/// when the panel opens — the same treatment `Artifact` gets. Caching it would
/// only create a second place for "is this paused?" to be wrong.

// MARK: - Recurrence

/// When a scheduled message repeats. Mirrors the server's discriminated union
/// exactly; presets stay structural rather than compiled to cron so reopening
/// the editor puts the same controls back.
enum Recurrence: Codable, Sendable, Equatable, Hashable {
    /// Fires once, then disables itself. `at` is an absolute instant.
    case once(at: Date)
    /// Every hour at `minute` past.
    case hourly(minute: Int)
    /// Every `hours` hours, counted from `anchor` (an absolute instant).
    case everyNHours(hours: Int, anchor: Date)
    /// Every day at local `hour`:`minute`.
    case daily(hour: Int, minute: Int)
    /// Every week on `weekday` (0 = Sunday) at local `hour`:`minute`.
    case weekly(weekday: Int, hour: Int, minute: Int)
    /// 5-field cron (`min hour dom mon dow`), evaluated in the row's timezone.
    case cron(expression: String)

    /// The wire discriminator — also the identity the editor's picker binds to.
    enum Kind: String, CaseIterable, Sendable {
        case once, hourly, everyNHours, daily, weekly, cron

        /// Label in the schedule picker. Matches the web dialog's options.
        var label: String {
            switch self {
            case .once: "Once"
            case .hourly: "Hourly"
            case .everyNHours: "Every N hours"
            case .daily: "Daily"
            case .weekly: "Weekly"
            case .cron: "Custom cron…"
            }
        }
    }

    var kind: Kind {
        switch self {
        case .once: .once
        case .hourly: .hourly
        case .everyNHours: .everyNHours
        case .daily: .daily
        case .weekly: .weekly
        case .cron: .cron
        }
    }

    private enum CodingKeys: String, CodingKey {
        case type, at, minute, hours, anchor, hour, weekday, expression
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "once":
            self = .once(at: try ISO8601.parseRequired(c.decode(String.self, forKey: .at)))
        case "hourly":
            self = .hourly(minute: try c.decode(Int.self, forKey: .minute))
        case "everyNHours":
            self = .everyNHours(
                hours: try c.decode(Int.self, forKey: .hours),
                anchor: try ISO8601.parseRequired(c.decode(String.self, forKey: .anchor))
            )
        case "daily":
            self = .daily(
                hour: try c.decode(Int.self, forKey: .hour),
                minute: try c.decode(Int.self, forKey: .minute)
            )
        case "weekly":
            self = .weekly(
                weekday: try c.decode(Int.self, forKey: .weekday),
                hour: try c.decode(Int.self, forKey: .hour),
                minute: try c.decode(Int.self, forKey: .minute)
            )
        case "cron":
            self = .cron(expression: try c.decode(String.self, forKey: .expression))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: c,
                debugDescription: "unknown recurrence type \(type)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind.rawValue, forKey: .type)
        switch self {
        case .once(let at):
            try c.encode(ISO8601.string(from: at), forKey: .at)
        case .hourly(let minute):
            try c.encode(minute, forKey: .minute)
        case .everyNHours(let hours, let anchor):
            try c.encode(hours, forKey: .hours)
            try c.encode(ISO8601.string(from: anchor), forKey: .anchor)
        case .daily(let hour, let minute):
            try c.encode(hour, forKey: .hour)
            try c.encode(minute, forKey: .minute)
        case .weekly(let weekday, let hour, let minute):
            try c.encode(weekday, forKey: .weekday)
            try c.encode(hour, forKey: .hour)
            try c.encode(minute, forKey: .minute)
        case .cron(let expression):
            try c.encode(expression, forKey: .expression)
        }
    }
}

/// Weekday names, Sunday-first, matching the server's `WEEKDAYS`.
enum ScheduleFormat {
    static let weekdayNames = [
        "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ]

    /// "9:30 AM" — deliberately hand-rolled rather than `DateFormatter`, because
    /// the hour and minute here are a *rule* (local wall clock, no date), not an
    /// instant, and the server's `clockLabel` says it exactly this way.
    static func clockLabel(hour: Int, minute: Int) -> String {
        let h12 = hour % 12 == 0 ? 12 : hour % 12
        let suffix = hour < 12 ? "AM" : "PM"
        return "\(h12):\(String(format: "%02d", minute)) \(suffix)"
    }

    /// Human-readable schedule ("Every 12 hours", "Weekly, Mon 9:30 AM").
    /// The Swift twin of the shared `describeRecurrence` — every client says a
    /// schedule the same way, so a row reads identically on web, macOS and iOS.
    static func describe(_ r: Recurrence, timezone: String? = nil) -> String {
        switch r {
        case .once(let at):
            let f = DateFormatter()
            f.locale = Locale.current
            f.setLocalizedDateFormatFromTemplate("MMM d, h:mm a")
            if let timezone, let tz = TimeZone(identifier: timezone) { f.timeZone = tz }
            return "Once, \(f.string(from: at))"
        case .hourly(let minute):
            return minute == 0
                ? "Hourly, on the hour"
                : "Hourly, at :\(String(format: "%02d", minute))"
        case .everyNHours(let hours, _):
            return hours == 1 ? "Every hour" : "Every \(hours) hours"
        case .daily(let hour, let minute):
            return "Daily at \(clockLabel(hour: hour, minute: minute))"
        case .weekly(let weekday, let hour, let minute):
            let name = weekdayNames.indices.contains(weekday) ? weekdayNames[weekday] : "Sunday"
            return "Weekly, \(name.prefix(3)) \(clockLabel(hour: hour, minute: minute))"
        case .cron(let expression):
            return "Cron: \(expression)"
        }
    }
}

// MARK: - The row

enum ScheduledRunStatus: String, Codable, Sendable {
    case ok
    case failed
}

/// One scheduled message. `body` is plaintext with the same `<@userId>` mention
/// tokens a typed message carries — a scheduled body mentioning an agent pings
/// it when it fires.
struct ScheduledMessage: Codable, Sendable, Equatable, Identifiable, Hashable {
    let id: String
    let workspaceId: String
    /// Destination conversation: a channel, or the author's self-DM ("Just me").
    let channelId: String
    let authorUserId: String
    let body: String
    let recurrence: Recurrence
    /// IANA name; occurrences are computed in this zone.
    let timezone: String
    /// Next fire time, or nil once a one-shot has run.
    let nextRunAt: String?
    let enabled: Bool
    let lastRunAt: String?
    let lastRunStatus: ScheduledRunStatus?
    /// The message the last successful run posted — what "view output" jumps to.
    let lastMessageId: String?
    /// Why the last run failed (or why the row was paused). Nil when fine.
    let lastError: String?
    let createdAt: String
    let updatedAt: String
    /// May this client's user edit, pause, run or delete this row (author or
    /// admin)? The server decides; the clients only draw what it allows.
    let canManage: Bool
}

/// GET /v1/scheduled-messages
struct ScheduledMessagesResponse: Decodable, Sendable {
    let scheduledMessages: [ScheduledMessage]
}

struct CreateScheduledMessageBody: Encodable, Sendable {
    let channelId: String
    let body: String
    let recurrence: Recurrence
    let timezone: String
}

/// PATCH /v1/scheduled-messages/:id. Every field optional — the server rejects
/// an empty patch, and omitting a field leaves it alone.
struct UpdateScheduledMessageBody: Encodable, Sendable {
    var channelId: String?
    var body: String?
    var recurrence: Recurrence?
    var timezone: String?
    var enabled: Bool?
}

// MARK: - Presentation rules

/// The status pill, shared by both clients so "Failed" and "Paused" cannot come
/// to mean different things on two screens.
///
/// Failed outranks Paused, because a row the server stopped for itself is a
/// different fact from one a person paused on purpose, and it's the one worth
/// surfacing. `lastError` is what tells them apart: the server sets it when it
/// pauses a row, and a manual pause clears it.
enum ScheduledStatus: Equatable, Sendable {
    case running
    case failed
    case paused
    case succeeded
    case scheduled

    static func of(_ row: ScheduledMessage, running: Bool) -> ScheduledStatus {
        if running { return .running }
        if row.lastRunStatus == .failed, row.lastError != nil { return .failed }
        if !row.enabled { return .paused }
        if row.lastRunStatus == .ok { return .succeeded }
        return .scheduled
    }

    var label: String {
        switch self {
        case .running: "● Running"
        case .failed: "✗ Failed"
        case .paused: "⏸ Paused"
        case .succeeded: "✓ Succeeded"
        case .scheduled: "Scheduled"
        }
    }
}
