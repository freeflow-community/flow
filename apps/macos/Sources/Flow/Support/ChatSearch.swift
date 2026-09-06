import Foundation
import SwiftUI

/// Inline chat find (#518): the model behind cmd-F. Matching, the wrap-around
/// match cursor, and the painting of matches into an already-rendered body.
///
/// Swift twin of `packages/web/src/lib/chatSearch.ts`, so "3 of 12" means the
/// same thing in both clients. The one rule worth stating: a match is counted
/// exactly where it can be *shown*, never anywhere else. Everything here
/// searches the characters a row actually draws — mention tokens resolved to
/// `@name`, markdown syntax gone — so the counter can never promise a hit the
/// eye cannot find.
enum ChatSearch {
    /// One occurrence, addressed the way the transcript is: which message, and
    /// the how-many-th match inside it.
    struct Match: Equatable {
        let messageId: String
        let occurrence: Int
    }

    /// What one row needs to paint itself: the live query, plus the index —
    /// within *this* message — of the globally current match, when it is here.
    struct RowHighlight: Equatable {
        let query: String
        let currentOccurrence: Int?
    }

    // MARK: - Matching

    /// Every non-overlapping, case-insensitive occurrence of `query`, in order.
    /// An empty query matches nothing: a find bar you have not typed into yet
    /// should highlight nothing, not everything.
    static func ranges(in haystack: String, query: String) -> [Range<String.Index>] {
        guard !query.isEmpty, !haystack.isEmpty else { return [] }
        var out: [Range<String.Index>] = []
        var from = haystack.startIndex
        while from < haystack.endIndex,
              let found = haystack.range(of: query, options: .caseInsensitive, range: from..<haystack.endIndex) {
            out.append(found)
            // `range(of:)` can return an empty range for degenerate queries;
            // stepping one character on keeps the loop finite either way.
            from = found.isEmpty ? haystack.index(after: found.lowerBound) : found.upperBound
        }
        return out
    }

    /// Where the match cursor lands after one step in `direction`, wrapping at
    /// both ends. With nothing to step through it stays at -1 — which is what
    /// "0 of 0" is rendered from, and what makes Enter a no-op.
    static func step(current: Int, total: Int, direction: Int) -> Int {
        guard total > 0 else { return -1 }
        if current < 0 { return direction > 0 ? 0 : total - 1 }
        return ((current + direction) % total + total) % total
    }

    /// The bar's counter: 1-based position, or "0/0" with nothing found.
    /// Clamped, because the transcript can grow (or an older page can land)
    /// between a cursor move and the next render.
    static func label(current: Int, total: Int) -> String {
        guard total > 0 else { return "0/0" }
        return "\(min(max(current, 0), total - 1) + 1)/\(total)"
    }

    // MARK: - What a row draws

    /// The rendered characters of one inline span — the markdown parsed away
    /// and mention tokens resolved, exactly as `MentionRendering.attributed`
    /// will draw them. `currentUserId` is deliberately nil: it only picks a
    /// pill colour, never a character.
    static func renderedText(_ text: String, names: [String: String]) -> String {
        String(MentionRendering.attributed(text, names: names, currentUserId: nil).characters)
    }

    /// The searchable strings of one body block, in the order the row draws
    /// them. Tables, diagrams and rules yield nothing: they are rendered by
    /// views that cannot carry a highlight, and a match nobody can see is
    /// worse than no match at all.
    static func searchableStrings(
        _ segment: MarkdownBlocks.Segment, names: [String: String]
    ) -> [String] {
        switch segment {
        case .paragraph(let text), .quote(let text):
            return [renderedText(text, names: names)]
        case .heading(_, let text):
            return [renderedText(text, names: names)]
        case .code(let text):
            return [text] // drawn verbatim, so it is searched verbatim
        case .ulist(let items):
            return items.map { renderedText($0, names: names) }
        case .olist(_, let items):
            return items.map { renderedText($0, names: names) }
        case .mermaid, .table, .hr:
            return []
        }
    }

    /// How many times `query` appears in one message's rendered body.
    static func matchCount(
        segments: [MarkdownBlocks.Segment], names: [String: String], query: String
    ) -> Int {
        guard !query.isEmpty else { return 0 }
        return segments.reduce(0) { total, segment in
            total + searchableStrings(segment, names: names)
                .reduce(0) { $0 + ranges(in: $1, query: query).count }
        }
    }

    /// Running occurrence offset for each of a row's blocks, so a block can
    /// work out whether the current match is one of its own without knowing
    /// what came before it.
    static func segmentBases(
        _ segments: [MarkdownBlocks.Segment], names: [String: String], query: String
    ) -> [Int] {
        var bases: [Int] = []
        var running = 0
        for segment in segments {
            bases.append(running)
            guard !query.isEmpty else { continue }
            running += searchableStrings(segment, names: names)
                .reduce(0) { $0 + ranges(in: $1, query: query).count }
        }
        return bases
    }

    // MARK: - Painting

    /// Soft wash under every match; the current one takes the accent outright.
    /// Same pairing as web's `::highlight(flow-find)` rules.
    static let matchBackground = MC.accent.opacity(0.22)
    static let currentBackground = MC.accent

    /// Highlight `query` inside an already-styled body run. `currentOccurrence`
    /// is counted within this run: out of range (or nil) simply means the
    /// cursor is somewhere else in the transcript.
    ///
    /// Ranges are found in the plain characters and converted by offset, which
    /// is what keeps the highlights and the counter describing the same set —
    /// both sides ask `ranges(in:query:)` about the same string.
    static func paint(
        _ attributed: inout AttributedString, query: String, currentOccurrence: Int?
    ) {
        guard !query.isEmpty else { return }
        let plain = String(attributed.characters)
        let found = ranges(in: plain, query: query)
        guard !found.isEmpty else { return }
        // `plain` is this string's own character view, so a character offset
        // taken there addresses the same character here.
        let total = plain.count
        for (i, range) in found.enumerated() {
            let start = plain.distance(from: plain.startIndex, to: range.lowerBound)
            let length = plain.distance(from: range.lowerBound, to: range.upperBound)
            guard start >= 0, length > 0, start + length <= total else { continue }
            let from = attributed.index(attributed.startIndex, offsetByCharacters: start)
            let to = attributed.index(from, offsetByCharacters: length)
            let isCursor = i == currentOccurrence
            attributed[from..<to].backgroundColor = isCursor ? currentBackground : matchBackground
            if isCursor { attributed[from..<to].foregroundColor = .white }
        }
    }
}

/// Rendered-body text per message, cached so a keystroke re-matches strings
/// rather than re-parsing every body's markdown. A plain class held in
/// `@State`, like `TranscriptRowCache`: mutating it touches no SwiftUI state
/// and its identity survives every body evaluation.
///
/// Keyed on the body alone. A display-name change while the bar is open can
/// leave one message's `@mention` text stale for a keystroke or two, which is
/// the cheapest possible price for not re-parsing the transcript on every
/// roster publish.
@MainActor
final class ChatSearchIndex {
    private var cache: [String: (body: String, strings: [String])] = [:]

    /// The searchable strings of one message, in draw order.
    func searchableStrings(for message: Message, names: [String: String]) -> [String] {
        if let hit = cache[message.id], hit.body == message.body { return hit.strings }
        let strings = MarkdownBlocks.segments(message.body)
            .flatMap { ChatSearch.searchableStrings($0, names: names) }
        cache[message.id] = (message.body, strings)
        return strings
    }

    /// Every match in `messages`, top to bottom. System lines and deleted
    /// messages are skipped: neither draws a body, so neither can show a hit.
    func matches(
        in messages: [Message], names: [String: String], query: String
    ) -> [ChatSearch.Match] {
        guard !query.isEmpty else { return [] }
        var out: [ChatSearch.Match] = []
        for message in messages where message.systemKind == nil && !message.isDeleted {
            let count = searchableStrings(for: message, names: names)
                .reduce(0) { $0 + ChatSearch.ranges(in: $1, query: query).count }
            for occurrence in 0..<count {
                out.append(ChatSearch.Match(messageId: message.id, occurrence: occurrence))
            }
        }
        return out
    }
}
