import GRDB
import SwiftUI

/// Message composer: expanding text field + send, typing-indicator emission,
/// and @-mention autocomplete (operator ruling: plain text + mention
/// autocomplete only on iOS — no live-styled fence composer). Shortcode and
/// mention sugar still expand at send time via SyncEngine.prepareOutgoing.
struct ComposerView: View {
    let channelId: String
    var threadRootId: String? = nil
    var placeholder: String = "Message"
    @EnvironmentObject var app: AppState
    @State private var text = ""
    @FocusState private var focused: Bool
    @StateObject private var members = DBObserved<[MemberRow]>(initial: [])

    var body: some View {
        VStack(spacing: 0) {
            if let s = suggestions, !s.items.isEmpty {
                suggestionBar(s)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(placeholder, text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 18).fill(MC.base))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(MC.hairline2))
                    .onSubmit(send)
                    .onChange(of: text) { _, newValue in
                        guard !newValue.isEmpty else { return }
                        Task { await app.engine.typing(channelId: channelId) }
                    }

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(canSend ? MC.send : MC.faint)
                }
                .disabled(!canSend)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(MC.base)
        .task(id: channelId) {
            members.start(db: app.db, reset: []) { db in
                try MemberRow.fetchAll(
                    db,
                    sql: """
                        SELECT u.id AS userId, u.displayName AS displayName
                        FROM member m JOIN user u ON u.id = m.userId
                        WHERE m.workspaceId = (SELECT workspaceId FROM channel WHERE id = ?)
                        ORDER BY u.displayName COLLATE NOCASE
                        """,
                    arguments: [channelId]
                )
            }
        }
    }

    private var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() {
        let body = text
        guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        text = ""
        Task { await app.engine.sendMessage(channelId: channelId, body: body, threadRootId: threadRootId) }
    }

    // MARK: - @-mention autocomplete (port of the macOS trailing-token logic)

    private struct Suggestions {
        let token: String // the trailing token, including "@"
        let items: [(insert: String, label: String)]
    }

    private var suggestions: Suggestions? {
        guard let sigilIdx = text.lastIndex(of: "@") else { return nil }
        let token = String(text[sigilIdx...])
        guard !token.dropFirst().contains(where: \.isWhitespace) else { return nil }
        let query = String(token.dropFirst())
        // sigil must start the message or follow whitespace
        if sigilIdx > text.startIndex {
            let before = text[text.index(before: sigilIdx)]
            guard before.isWhitespace else { return nil }
        }
        guard query.count >= 1, !query.contains("@") else { return nil }
        let lower = query.lowercased()
        var items: [(String, String)] = ["channel", "here", "everyone"]
            .filter { $0.hasPrefix(lower) }
            .map { ("@\($0) ", "@\($0)") }
        items += members.value
            .filter { $0.userId != app.currentUser?.id && $0.displayName.lowercased().hasPrefix(lower) }
            .prefix(6)
            .map { ("@\($0.displayName) ", "@\($0.displayName)") }
        return Suggestions(token: token, items: Array(items.prefix(8)))
    }

    /// Horizontal chip row above the input; tapping inserts the mention.
    private func suggestionBar(_ s: Suggestions) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(s.items.enumerated()), id: \.offset) { _, item in
                    Button {
                        if let range = text.range(of: s.token, options: .backwards) {
                            text.replaceSubrange(range, with: item.insert)
                        }
                    } label: {
                        Text(item.label)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(MC.accent)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(MC.accent.opacity(0.10)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("composer.suggestion.\(item.label)")
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
    }
}

/// Workspace member row for mention autocomplete (joined member + user).
private struct MemberRow: Decodable, FetchableRecord, Equatable, Sendable {
    var userId: String
    var displayName: String
}

/// Typing indicator row (same 5s expiry semantics as web/macOS — the shared
/// AppState owns the map and expiry; this just renders it).
struct TypingIndicatorView: View {
    let channelId: String
    let userNames: [String: String]
    @EnvironmentObject private var app: AppState

    var body: some View {
        let ids = app.typingUserIds(channelId: channelId)
        HStack {
            if !ids.isEmpty {
                let names = ids.map { userNames[$0] ?? "Someone" }
                Text(typingText(names))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("typing.indicator")
            }
            Spacer()
        }
        .frame(height: 16)
        .padding(.horizontal, 14)
        .background(MC.base)
    }

    private func typingText(_ names: [String]) -> String {
        switch names.count {
        case 1: "\(names[0]) is typing…"
        case 2: "\(names[0]) and \(names[1]) are typing…"
        default: "Several people are typing…"
        }
    }
}
