import Foundation

/// One renderable transcript row, precomputed once when the message array
/// changes instead of on every render pass. Shared by the macOS and iOS
/// message lists (`Support/` is the one source tree both apps compile).
///
/// Why this exists: the lists used to compute Slack-style grouping
/// (`showsHeader`), day dividers and — worst — the full markdown block
/// segmentation inside `body`/`ForEach`, so every list re-evaluation re-parsed
/// every visible message. During a scroll the list re-evaluates on each frame
/// (its geometry tracking writes `@State`), which made long transcripts feel
/// slow and busy. Rows are now built once per message-array change, and the
/// parse results are reused across rebuilds for messages whose body didn't
/// change.
struct TranscriptRow: Equatable, Identifiable {
    let message: Message
    /// Slack-style author grouping: header shown when the sender changes or
    /// more than 5 minutes passed since the previous message.
    let showsHeader: Bool
    /// A day divider is rendered above this row.
    let startsNewDay: Bool
    /// Parsed body blocks. Empty for system lines (they render the raw body)
    /// and for empty bodies (attachment-only messages).
    let segments: [MarkdownBlocks.Segment]

    var id: String { message.id }
}

/// Everything a message row needs from the app, passed by value so the rows
/// no longer observe `AppState` as a whole. Before this, every `AppState`
/// publish — someone typing, presence, a loading flag — re-rendered every
/// visible row through its `@EnvironmentObject`, and each render re-ran the
/// markdown pass. Equality deliberately ignores the closures: they are
/// recreated on every parent evaluation but their behavior never changes.
struct TranscriptContext: Equatable {
    let engine: SyncEngine
    var avatarPaths: [String: String] = [:]
    var agentIds: Set<String> = []
    /// Surfacing a failed engine call (macOS `AppState.showError`).
    var onError: (String) -> Void = { _ in }
    /// Open a just-created artifact in the side panel (macOS only).
    var onSelectArtifact: (String) -> Void = { _ in }

    static func == (a: Self, b: Self) -> Bool {
        a.engine === b.engine
            && a.avatarPaths == b.avatarPaths
            && a.agentIds == b.agentIds
    }
}

/// Builds `TranscriptRow`s from a message array, reusing parse results across
/// rebuilds. Held as plain `@State` by the list views: mutating the cache never
/// touches SwiftUI state, and the identity is stable across body evaluations.
final class TranscriptRowCache {
    private var lastMessages: [Message] = []
    private var lastRows: [TranscriptRow] = []
    /// Per-message parse results keyed by id, kept only for messages still in
    /// the transcript so the cache can't grow past the loaded history.
    private var segments: [String: (body: String, segments: [MarkdownBlocks.Segment])] = [:]

    /// The rows for `messages` — the cached array when nothing changed (the
    /// common case for the per-frame calls during a scroll), otherwise a
    /// rebuild that only re-parses added or edited messages.
    func rows(for messages: [Message]) -> [TranscriptRow] {
        if messages == lastMessages { return lastRows }
        var rows: [TranscriptRow] = []
        rows.reserveCapacity(messages.count)
        var kept: [String: (body: String, segments: [MarkdownBlocks.Segment])] = [:]
        kept.reserveCapacity(messages.count)

        var prev: Message?
        var prevDate: Date?
        for message in messages {
            let date = ISO8601.parse(message.createdAt)
            let newDay = TranscriptRows.startsNewDay(prevDate: prevDate, date: date, isFirst: prev == nil)
            rows.append(TranscriptRow(
                message: message,
                showsHeader: TranscriptRows.showsHeader(
                    prev: prev, prevDate: prevDate, message: message, date: date, startsNewDay: newDay
                ),
                startsNewDay: newDay,
                segments: cachedSegments(for: message, keep: &kept)
            ))
            prev = message
            prevDate = date
        }

        lastMessages = messages
        lastRows = rows
        segments = kept
        return rows
    }

    private func cachedSegments(
        for message: Message,
        keep: inout [String: (body: String, segments: [MarkdownBlocks.Segment])]
    ) -> [MarkdownBlocks.Segment] {
        // System lines render their raw body — nothing to parse.
        guard message.systemKind == nil else { return [] }
        if let hit = segments[message.id] ?? keep[message.id], hit.body == message.body {
            keep[message.id] = hit
            return hit.segments
        }
        let parsed = MarkdownBlocks.segments(message.body)
        keep[message.id] = (message.body, parsed)
        return parsed
    }
}

/// The grouping rules, pure and testable. Exactly the logic the two
/// `MessageListView`s carried as `showsHeader(at:)` / `startsNewDay(at:)`.
enum TranscriptRows {
    /// The author header is shown when a run of messages breaks: first row,
    /// new day, after a system line, a different sender, unparseable dates,
    /// or more than 5 minutes since the previous message.
    static func showsHeader(
        prev: Message?, prevDate: Date?, message: Message, date: Date?, startsNewDay: Bool
    ) -> Bool {
        guard let prev else { return true }
        if startsNewDay { return true }
        if prev.systemKind != nil { return true }
        if prev.userId != message.userId { return true }
        guard let prevDate, let date else { return true }
        return date.timeIntervalSince(prevDate) > 300
    }

    /// First row always starts a "day"; after that, a calendar-day change.
    /// Unparseable dates never start one (the header rule covers them).
    static func startsNewDay(prevDate: Date?, date: Date?, isFirst: Bool) -> Bool {
        guard !isFirst else { return true }
        guard let prevDate, let date else { return false }
        return !Calendar.current.isDate(prevDate, inSameDayAs: date)
    }
}
