import AppKit
import GRDB
import SwiftUI

struct ComposerView: View {
    let channelId: String
    let workspaceId: String?
    let threadRootId: String?
    let placeholder: String

    @EnvironmentObject private var app: AppState
    @State private var text = ""
    @State private var attachments: [FileAttachment] = []
    @State private var uploading = 0
    @FocusState private var focused: Bool
    @StateObject private var members = DBObserved<[MemberInfo]>(initial: [])

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let suggestions = autocomplete, !suggestions.items.isEmpty {
                suggestionBar(suggestions)
            }

            if !attachments.isEmpty || uploading > 0 {
                attachmentBar
            }

            HStack(alignment: .bottom, spacing: 8) {
                Button(action: pickFiles) {
                    Image(systemName: "paperclip")
                }
                .buttonStyle(.borderless)
                .help("Attach files")
                .accessibilityIdentifier(threadRootId == nil ? "composer.attach" : "thread.composer.attach")

                TextField(placeholder, text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .focused($focused)
                    .onSubmit(send)
                    .onChange(of: text) { _, newValue in
                        guard !newValue.isEmpty else { return }
                        Task { await app.engine.typing(channelId: channelId) }
                    }
                    .accessibilityIdentifier(threadRootId == nil ? "composer.input" : "thread.composer.input")

                Button {
                    // Operator ruling: macOS uses the native character palette.
                    focused = true
                    NSApplication.shared.orderFrontCharacterPalette(nil)
                } label: {
                    Image(systemName: "face.smiling")
                }
                .buttonStyle(.borderless)
                .help("Insert emoji")
                .accessibilityIdentifier(threadRootId == nil ? "composer.emoji" : "thread.composer.emoji")

                Button(action: send) {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(RoundedRectangle(cornerRadius: 8).fill(MC.send))
                        .opacity(canSend ? 1 : 0.4)
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .help("Send message")
                .accessibilityIdentifier(threadRootId == nil ? "composer.send" : "thread.composer.send")
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.white)
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(MC.hairline2, lineWidth: 1))
        )
        .padding([.horizontal, .bottom], 22)
        .padding(.top, 4)
        .onAppear { focused = true }
        .task(id: workspaceId) {
            guard let wsId = workspaceId else { return }
            members.start(db: app.db, reset: []) { db in
                try MemberInfo.fetchAll(
                    db,
                    sql: """
                        SELECT m.userId AS userId, u.displayName AS displayName, m.role AS role
                        FROM member m JOIN user u ON u.id = m.userId
                        WHERE m.workspaceId = ?
                        ORDER BY u.displayName COLLATE NOCASE
                        """,
                    arguments: [wsId]
                )
            }
        }
    }

    private var canSend: Bool {
        uploading == 0 &&
            (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
    }

    // MARK: - Autocomplete (@mentions and :shortcodes:)

    private struct Suggestions {
        enum Kind { case mention, emoji }
        let kind: Kind
        let token: String // the trailing token, including its sigil
        let items: [(insert: String, label: String)]
    }

    private var autocomplete: Suggestions? {
        // Trailing token: from the last whitespace/newline to the end.
        guard let sigilIdx = text.lastIndex(where: { $0 == "@" || $0 == ":" }) else { return nil }
        let token = String(text[sigilIdx...])
        guard !token.dropFirst().contains(where: \.isWhitespace) else { return nil }
        let query = String(token.dropFirst())
        // sigil must start the message or follow whitespace
        if sigilIdx > text.startIndex {
            let before = text[text.index(before: sigilIdx)]
            guard before.isWhitespace else { return nil }
        }
        if token.first == "@" {
            guard query.count >= 1, !query.contains("@") else { return nil }
            let lower = query.lowercased()
            var items: [(String, String)] = ["channel", "here", "everyone"]
                .filter { $0.hasPrefix(lower) }
                .map { ("@\($0) ", "@\($0)") }
            items += members.value
                .filter { $0.userId != app.currentUser?.id && $0.displayName.lowercased().hasPrefix(lower) }
                .prefix(6)
                .map { ("@\($0.displayName) ", "@\($0.displayName)") }
            return Suggestions(kind: .mention, token: token, items: Array(items.prefix(8)))
        } else {
            guard query.count >= 2 else { return nil }
            let matches = EmojiCatalog.matches(prefix: query)
            return Suggestions(
                kind: .emoji,
                token: token,
                items: matches.map { ("\($0.emoji) ", "\($0.emoji) :\($0.code):") }
            )
        }
    }

    private func suggestionBar(_ s: Suggestions) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(s.items.enumerated()), id: \.offset) { _, item in
                    Button(item.label) {
                        // replace the trailing token with the completion
                        if let range = text.range(of: s.token, options: .backwards) {
                            text.replaceSubrange(range, with: item.insert)
                        }
                        focused = true
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityIdentifier("composer.suggestion.\(item.label)")
                }
            }
        }
        .frame(height: 26)
    }

    // MARK: - Attachments

    private var attachmentBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(attachments) { file in
                    HStack(spacing: 4) {
                        Image(systemName: file.isImage ? "photo" : "doc")
                            .font(.caption)
                        Text(file.name)
                            .font(.caption)
                            .lineLimit(1)
                            .frame(maxWidth: 140)
                        Button {
                            attachments.removeAll { $0.id == file.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(.secondary.opacity(0.12)))
                    .accessibilityIdentifier("composer.attachment.\(file.name)")
                }
                if uploading > 0 {
                    HStack(spacing: 4) {
                        ProgressView().controlSize(.mini)
                        Text("Uploading…").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .frame(height: 26)
    }

    private func pickFiles() {
        guard let wsId = workspaceId else { return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.begin { response in
            guard response == .OK else { return }
            let urls = panel.urls
            uploading += urls.count
            for url in urls {
                Task { @MainActor in
                    defer { uploading -= 1 }
                    do {
                        let file = try await app.engine.uploadFile(workspaceId: wsId, fileURL: url)
                        if attachments.count < 10 { attachments.append(file) }
                    } catch {
                        app.showError("Couldn't upload \(url.lastPathComponent): \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    // MARK: - Send

    private func send() {
        guard canSend else { return }
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = attachments
        text = ""
        attachments = []
        Task {
            await app.engine.sendMessage(
                channelId: channelId,
                body: body,
                threadRootId: threadRootId,
                attachments: files
            )
        }
    }
}
