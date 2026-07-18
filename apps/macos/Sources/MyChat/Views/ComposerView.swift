import AppKit
import GRDB
import SwiftUI
import UniformTypeIdentifiers

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
                    // Image paste → upload as attachment. `.string` is
                    // deliberately absent so plain-text paste stays native.
                    .onPasteCommand(of: [.png, .tiff, .jpeg, .fileURL], perform: handlePaste)

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

    // MARK: - Image paste (phase 3.5 item 3)

    /// Uploads pasted images through the same attachment flow as the
    /// paperclip picker (cap 10, shared uploading counter).
    private func handlePaste(_ providers: [NSItemProvider]) {
        guard let wsId = workspaceId else { return }
        for provider in providers {
            uploading += 1
            Task { @MainActor in
                defer { uploading -= 1 }
                do {
                    guard let url = try await Self.pastedImageFileURL(from: provider) else { return }
                    let file = try await app.engine.uploadFile(workspaceId: wsId, fileURL: url)
                    if attachments.count < 10 { attachments.append(file) }
                } catch {
                    app.showError("Couldn't paste image: \(error.localizedDescription)")
                }
            }
        }
    }

    private static let pastedImageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "tiff", "tif", "heic", "bmp",
    ]

    /// Resolves a pasted item to a local image file URL. File URLs are used
    /// as-is (image extensions only); raw image data is written to a temp
    /// PNG (non-PNG data converted via NSBitmapImageRep). Returns nil for
    /// non-image content.
    private static func pastedImageFileURL(from provider: NSItemProvider) async throws -> URL? {
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            let data = try await loadData(from: provider, type: .fileURL)
            guard let url = URL(dataRepresentation: data, relativeTo: nil),
                  pastedImageExtensions.contains(url.pathExtension.lowercased())
            else { return nil }
            return url
        }
        for type in [UTType.png, .tiff, .jpeg]
        where provider.hasItemConformingToTypeIdentifier(type.identifier) {
            let data = try await loadData(from: provider, type: type)
            let png = type == .png
                ? data
                : NSBitmapImageRep(data: data)?.representation(using: .png, properties: [:])
            guard let png else { return nil }
            let epochMs = Int(Date().timeIntervalSince1970 * 1000)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("pasted-\(epochMs).png")
            try png.write(to: url)
            return url
        }
        return nil
    }

    private static func loadData(from provider: NSItemProvider, type: UTType) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            _ = provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, error in
                if let data {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: error ?? APIError(
                        status: 0, code: "paste", message: "Couldn't read pasted item"
                    ))
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
