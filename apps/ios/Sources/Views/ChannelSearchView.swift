import SwiftUI

/// In-channel search (#570): the field that drops out from under the channel
/// header, and the result list it feeds.
///
/// Matching is *not* reimplemented here. `ChatSearch` / `ChatSearchIndex`
/// (`apps/macos/Sources/Flow/Support/`, already compiled into this target) are
/// the same model behind macOS's ⌘F find bar and web's find bar, so a hit means
/// the same thing on all three clients: a match is counted only where it can be
/// *shown* — mention tokens resolved to `@name`, markdown syntax parsed away.
///
/// What differs is the shape of the answer, and deliberately. A Mac has ⌘G and
/// a window wide enough to step a cursor through highlights in place; a phone
/// has neither, so iOS answers with a list of matching messages and a tap to
/// jump to one in context (issue #570 leaves that choice to the implementer).
enum ChannelSearch {
    /// How many of the channel's cached messages search looks at. Far beyond
    /// any transcript window, and still a bound — a channel with a hundred
    /// thousand cached rows should not parse all of them on a keystroke.
    /// Lives here rather than on the view so the database closure that reads it
    /// stays `Sendable`.
    static let corpusLimit = 2000

    /// The messages whose rendered body contains `query`, newest first.
    ///
    /// System lines and deleted rows are skipped for the same reason the other
    /// clients skip them: neither draws a body, so neither can show a hit.
    /// Ordering is newest-first because that is what a search over a
    /// conversation is usually asking for — the Mac's cursor walks the
    /// transcript top to bottom, but a list wants the recent end first.
    @MainActor
    static func results(
        in messages: [Message], index: ChatSearchIndex, names: [String: String], query: String
    ) -> [Message] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return [] }
        return messages.filter { message in
            guard message.systemKind == nil, !message.isDeleted else { return false }
            return index.searchableStrings(for: message, names: names)
                .contains { !ChatSearch.ranges(in: $0, query: q).isEmpty }
        }
    }

    /// How much of a matching line a result row shows, and how much of it comes
    /// before the match. Enough to read the hit in context on the narrowest
    /// phone without pushing the row past three lines.
    private static let snippetLength = 160
    private static let snippetLead = 40

    /// One result row's text: the first line of the message that actually
    /// matches, trimmed to a window around the first hit, with every hit in
    /// that window washed in the accent.
    ///
    /// Trimming to the *matching* line matters for the long messages agents
    /// write: a snippet taken from the top of the body would routinely show
    /// none of the word that was searched for.
    @MainActor
    static func snippet(
        for message: Message, index: ChatSearchIndex, names: [String: String], query: String
    ) -> AttributedString {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let strings = index.searchableStrings(for: message, names: names)
        let line = strings.first { !ChatSearch.ranges(in: $0, query: q).isEmpty }
            ?? strings.first
            ?? message.files.first?.name
            ?? ""
        var attributed = AttributedString(window(of: line, around: q))
        ChatSearch.paint(&attributed, query: q, currentOccurrence: nil)
        return attributed
    }

    /// The characters around the first hit, with ellipses marking either end
    /// that was cut. Newlines collapse to spaces: a row draws one line of text,
    /// so a body's line breaks would otherwise become blank space inside it.
    static func window(of line: String, around query: String) -> String {
        let flat = line
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
        guard flat.count > snippetLength else { return flat }
        let hit = ChatSearch.ranges(in: flat, query: query).first
        let hitOffset = hit.map { flat.distance(from: flat.startIndex, to: $0.lowerBound) } ?? 0
        let start = max(0, min(hitOffset - snippetLead, flat.count - snippetLength))
        let end = min(flat.count, start + snippetLength)
        let from = flat.index(flat.startIndex, offsetBy: start)
        let to = flat.index(flat.startIndex, offsetBy: end)
        return (start > 0 ? "…" : "") + String(flat[from..<to]) + (end < flat.count ? "…" : "")
    }

    /// The result count, or the empty-query prompt. Singular/plural matters
    /// here because it is the only line on screen when nothing matched.
    static func countLabel(_ count: Int, query: String) -> String {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "" }
        switch count {
        case 0: return "No matches"
        case 1: return "1 message"
        default: return "\(count) messages"
        }
    }
}

/// The search field itself, drawn as a card directly beneath the floating
/// header pill. Styled after the Directory's field (`DirectoryScreen`), for the
/// same reason it gives: a plain `TextField` rather than `.searchable`, so the
/// field stays where the design puts it instead of wherever iOS 26 decides to
/// float a system search bar.
struct ChannelSearchField: View {
    let placeholder: String
    @Binding var query: String
    /// Bumped by the caller when the header is tapped again while the field is
    /// already open — the field takes focus back rather than doing nothing.
    let focusTick: Int
    let onCancel: () -> Void

    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14))
                    .foregroundStyle(MC.muted)
                TextField(placeholder, text: $query)
                    .font(.system(size: 15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .focused($focused)
                    .accessibilityIdentifier("channel.search.query")
                    .accessibilityLabel(placeholder)
                if !query.isEmpty {
                    Button {
                        query = ""
                        focused = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 15))
                            .foregroundStyle(MC.muted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                    .accessibilityIdentifier("channel.search.clear")
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 10).fill(MC.chat))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(MC.hairline2, lineWidth: 1))

            Button("Cancel", action: onCancel)
                .font(.system(size: 15))
                .foregroundStyle(MC.accent)
                .buttonStyle(.plain)
                .accessibilityIdentifier("channel.search.cancel")
        }
        .padding(.horizontal, 14)
        // Deeper at the top: the bar's background starts at the floating pill's
        // bottom edge, so this is the gap under the pill as well as the field's
        // own breathing room.
        .padding(.top, 14)
        .padding(.bottom, 10)
        .background(MC.base)
        .overlay(alignment: .bottom) { Divider() }
        // The keyboard comes up with the field, per the ticket. `.onAppear` is
        // one frame too early for a field that arrives with a transition, so
        // focus is taken from a task that has let the first frame land.
        .task {
            try? await Task.sleep(for: .milliseconds(50))
            focused = true
        }
        .onChange(of: focusTick) { _, _ in focused = true }
    }
}

/// The results, covering the transcript while the field is open. The transcript
/// itself is untouched underneath — which is what "scroll position preserved"
/// on dismissal amounts to: there is nothing to restore, because nothing moved.
struct ChannelSearchResults: View {
    let results: [Message]
    let query: String
    let userNames: [String: String]
    let index: ChatSearchIndex
    /// Shown under the last row when the server still holds older messages this
    /// device has never cached — search can only look at what is on the device,
    /// and saying so is better than an empty state that implies "not there".
    let canLoadOlder: Bool
    let isLoadingOlder: Bool
    let onLoadOlder: () -> Void
    let onSelect: (Message) -> Void

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Group {
            if trimmed.isEmpty {
                prompt
            } else if results.isEmpty {
                empty
            } else {
                list
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MC.base)
    }

    /// Typed nothing yet: say what typing will do rather than showing a blank
    /// panel or, worse, every message in the channel.
    private var prompt: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 28))
                .foregroundStyle(MC.faint)
            Text("Search this conversation")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(MC.inkSoft)
            Text("Type to find messages in this channel.")
                .font(.system(size: 13))
                .foregroundStyle(MC.muted)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("channel.search.prompt")
    }

    private var empty: some View {
        VStack(spacing: 8) {
            Text("No matches")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(MC.inkSoft)
                .accessibilityIdentifier("channel.search.empty")
            Text("Nothing in this channel matches “\(trimmed)”.")
                .font(.system(size: 13))
                .foregroundStyle(MC.muted)
                .multilineTextAlignment(.center)
            if canLoadOlder { loadOlderButton }
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                Text(ChannelSearch.countLabel(results.count, query: query))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(MC.muted)
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 6)
                    .accessibilityIdentifier("channel.search.count")
                ForEach(results) { message in
                    Button { onSelect(message) } label: {
                        row(message)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("channel.search.result")
                    Divider().padding(.leading, 16)
                }
                if canLoadOlder {
                    loadOlderButton
                        .padding(.vertical, 14)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func row(_ message: Message) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(userNames[message.userId] ?? "Unknown")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(MC.ink)
                Text(ISO8601.parse(message.createdAt)?.formatted(date: .abbreviated, time: .shortened) ?? "")
                    .font(.system(size: 11))
                    .foregroundStyle(MC.faint)
                Spacer(minLength: 0)
                if message.threadRootId != nil {
                    Text("Thread")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(MC.accent)
                }
            }
            Text(ChannelSearch.snippet(for: message, index: index, names: userNames, query: query))
                .font(.system(size: 14))
                .foregroundStyle(MC.inkSoft)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var loadOlderButton: some View {
        Button(action: onLoadOlder) {
            if isLoadingOlder {
                ProgressView().controlSize(.small)
            } else {
                Text("Search earlier messages")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(MC.accent)
            }
        }
        .buttonStyle(.plain)
        .disabled(isLoadingOlder)
        .accessibilityIdentifier("channel.search.loadOlder")
    }
}
