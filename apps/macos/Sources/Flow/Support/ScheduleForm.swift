import Foundation

/// The editable state behind the create/edit schedule controls (#424), and the
/// two conversions that surround it: an existing row → the controls, and the
/// controls → the wire shape.
///
/// Pure and platform-free on purpose. Both the macOS sheet and the iOS sheet
/// bind to this, so "every 12 hours starting 6:00 AM" cannot mean two different
/// things on two screens, and the rules are unit-testable without a view.
struct ScheduleForm: Equatable, Sendable {
    var kind: Recurrence.Kind = .daily
    /// Absolute instant for a one-shot.
    var onceAt: Date = Date().addingTimeInterval(3600)
    /// Wall-clock carrier for daily / weekly / everyNHours. Only its hour and
    /// minute are read — the date part is scaffolding for a time picker.
    var timeOfDay: Date = ScheduleForm.time(hour: 9, minute: 0)
    /// Minutes past the hour, for `hourly`.
    var minute: Int = 0
    /// 0 = Sunday, matching the server.
    var weekday: Int = 1
    var everyHours: Int = 12
    var cron: String = "0 9 * * 1-5"

    /// Offered every-N-hours cadences — the web dialog's list.
    static let everyNChoices = [2, 3, 4, 6, 8, 12]
    /// Offered "at :NN" minutes for an hourly schedule.
    static let hourlyMinutes = [0, 15, 30, 45]

    /// A Date whose hour/minute are the ones asked for (today's date; unused).
    static func time(hour: Int, minute: Int) -> Date {
        Calendar.current.date(
            bySettingHour: hour, minute: minute, second: 0, of: Date()
        ) ?? Date()
    }

    /// Today at `timeOfDay` local, rolled to tomorrow if that has already
    /// passed — what "starting 6:00 AM" means for an every-N-hours anchor.
    static func nextOccurrence(of wallClock: Date, now: Date = Date()) -> Date {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: wallClock)
        var at = Calendar.current.date(
            bySettingHour: parts.hour ?? 9, minute: parts.minute ?? 0, second: 0, of: now
        ) ?? now
        if at <= now { at = Calendar.current.date(byAdding: .day, value: 1, to: at) ?? at }
        return at
    }

    /// The zone the user means when they type "9:00".
    static var localTimezone: String { TimeZone.current.identifier }

    /// Reopen an existing row into the same controls that produced it — the
    /// reason recurrences are stored structurally rather than compiled to cron.
    init(existing: ScheduledMessage? = nil) {
        guard let r = existing?.recurrence else { return }
        switch r {
        case .once(let at):
            kind = .once
            onceAt = at
        case .hourly(let m):
            kind = .hourly
            minute = m
        case .everyNHours(let hours, let anchor):
            kind = .everyNHours
            everyHours = hours
            timeOfDay = anchor
        case .daily(let hour, let m):
            kind = .daily
            timeOfDay = Self.time(hour: hour, minute: m)
        case .weekly(let day, let hour, let m):
            kind = .weekly
            weekday = day
            timeOfDay = Self.time(hour: hour, minute: m)
        case .cron(let expression):
            kind = .cron
            cron = expression
        }
    }

    /// The one thing the controls can't prevent: a "once" date in the past —
    /// a time picker will happily offer this morning.
    enum Invalid: Error, LocalizedError, Equatable {
        case pastOneShot
        case emptyCron

        var errorDescription: String? {
            switch self {
            case .pastOneShot: "Pick a time in the future"
            case .emptyCron: "Enter a 5-field cron expression"
            }
        }
    }

    /// Controls → the wire shape.
    func buildRecurrence(now: Date = Date()) throws -> Recurrence {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: timeOfDay)
        let hour = parts.hour ?? 9
        let min = parts.minute ?? 0
        switch kind {
        case .once:
            guard onceAt > now else { throw Invalid.pastOneShot }
            return .once(at: onceAt)
        case .hourly:
            return .hourly(minute: minute)
        case .everyNHours:
            return .everyNHours(
                hours: everyHours, anchor: Self.nextOccurrence(of: timeOfDay, now: now)
            )
        case .daily:
            return .daily(hour: hour, minute: min)
        case .weekly:
            return .weekly(weekday: weekday, hour: hour, minute: min)
        case .cron:
            let expression = cron.trimmingCharacters(in: .whitespaces)
            guard !expression.isEmpty else { throw Invalid.emptyCron }
            return .cron(expression: expression)
        }
    }
}

/// What the create/edit sheet was opened for. Identifiable so SwiftUI's
/// `.sheet(item:)` drives it, and shared by both clients so the composer
/// hand-off (prefilled body + current conversation) works the same way on each.
enum ScheduleEditorTarget: Identifiable, Equatable {
    /// New row. `body` carries whatever the composer already had typed; nil
    /// `channelId` means "let the sheet pick a sensible default".
    case creating(body: String, channelId: String?)
    case editing(ScheduledMessage)

    var id: String {
        switch self {
        case .creating: "new"
        case .editing(let row): row.id
        }
    }

    var existing: ScheduledMessage? {
        if case .editing(let row) = self { return row }
        return nil
    }
}

/// Destination choices for the "Post to" picker: the author's "🔒 Just me"
/// conversation first, then every standard channel they're in, by name.
///
/// Group DMs are deliberately absent — a scheduled message posts as you, and
/// the two destinations that read sensibly are your own notes and a channel you
/// are a member of. Shared so both clients offer the same list as the web.
enum ScheduleDestinations {
    struct Choice: Identifiable, Equatable {
        let id: String
        let label: String
        /// "Personal" or "Shared" — the little tag on the row.
        let tag: String
    }

    static func choices(channels: [Channel], me: String?) -> [Choice] {
        var out: [Choice] = []
        if let selfDm = channels.first(where: { $0.isMember && $0.isSelfDm(me: me) }) {
            out.append(Choice(id: selfDm.id, label: "🔒 Just me", tag: "Personal"))
        }
        let joined = channels
            .filter { $0.isMember && $0.kind == "standard" && $0.archivedAt == nil }
            .sorted { ($0.name ?? "") < ($1.name ?? "") }
        out.append(contentsOf: joined.map {
            Choice(id: $0.id, label: "# \($0.name ?? "")", tag: "Shared")
        })
        return out
    }
}
