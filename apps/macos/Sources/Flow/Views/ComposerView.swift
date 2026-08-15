import AppKit
import GRDB
import SwiftUI

struct ComposerView: View {
    let channelId: String
    let workspaceId: String?
    let threadRootId: String?
    let placeholder: String
    /// ↑ in an empty composer: start editing the caller's last message when it
    /// is the newest here (ui_nits item 4, Slack semantics). Return true when
    /// an edit was started (consumes the key).
    var onEditLast: (() -> Bool)? = nil

    @EnvironmentObject private var app: AppState
    @State private var text = ""
    @State private var attachments: [FileAttachment] = []
    @State private var uploading = 0
    @State private var focusRequest = 0
    @State private var suggestionIndex = 0
    @State private var suppressedToken: String?
    @State private var dropTargeted = false
    @State private var missingMentions: [MentionMiss] = []
    @StateObject private var members = DBObserved<[MemberInfo]>(initial: [])

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !missingMentions.isEmpty {
                mentionInviteBanner
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

                // NSTextView-backed input with live blockquote/code-fence
                // styling (phase-3.5 ruling 2). Same AX identifiers as the
                // old TextField; the AX role becomes text area. Image paste
                // is intercepted in the subclass and routed to uploads.
                ZStack(alignment: .topLeading) {
                    MarkdownComposerTextView(
                        text: $text,
                        axIdentifier: threadRootId == nil ? "composer.input" : "thread.composer.input",
                        focusRequest: focusRequest,
                        onSend: send,
                        onPasteImages: handlePasteImages,
                        onCommand: handleCommand,
                        onDropFiles: { urls in
                            uploadFiles(urls)
                            return true
                        }
                    )
                    if text.isEmpty {
                        Text(placeholder)
                            .flowFont(size: 13)
                            .foregroundStyle(MC.muted)
                            .padding(.leading, 5) // line-fragment padding
                            .padding(.top, 2) // text-container inset
                            .allowsHitTesting(false)
                    }
                }
                .onChange(of: text) { _, newValue in
                    guard !newValue.isEmpty else { return }
                    Task { await app.engine.typing(channelId: channelId, threadRootId: threadRootId) }
                }

                Button {
                    // Operator ruling: macOS uses the native character palette.
                    focusRequest += 1
                    NSApplication.shared.orderFrontCharacterPalette(nil)
                } label: {
                    Image(systemName: "face.smiling")
                }
                .buttonStyle(.borderless)
                .help("Insert emoji")
                .accessibilityIdentifier(threadRootId == nil ? "composer.emoji" : "thread.composer.emoji")

                Button(action: send) {
                    Image(systemName: "paperplane.fill")
                        .flowFont(size: 12)
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
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(dropTargeted ? MC.accent : MC.hairline2, lineWidth: 1)
                )
        )
        // Clicking anywhere on the card (padding, whitespace) focuses the
        // input; buttons and the text view keep their own click handling.
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { focusRequest += 1 }
        // Drops on the card outside the text view (the text view routes its own).
        .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
            for provider in providers {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url, url.isFileURL {
                        Task { @MainActor in uploadFiles([url]) }
                    }
                }
            }
            return true
        }
        .onChange(of: autocomplete?.token) { _, _ in suggestionIndex = 0 }
        .padding([.horizontal, .bottom], 22)
        .padding(.top, 4)
        // The typeahead floats *above* the card (web parity: absolute
        // bottom-full). Putting it inside the VStack resized the composer on
        // every keystroke, and a composer height change makes the message
        // list scroll into empty space and blank the transcript (#97's
        // remaining trigger).
        .overlay(alignment: .topLeading) {
            if let suggestions = autocomplete, !suggestions.items.isEmpty {
                suggestionBar(suggestions)
                    .padding(.leading, 22)
                    // Report the popup's bottom as its top so it hangs above
                    // the composer instead of covering it.
                    .alignmentGuide(.top) { $0[.bottom] }
            }
        }
        .task(id: workspaceId) {
            guard let wsId = workspaceId else { return }
            members.start(db: app.db, reset: []) { db in
                try MemberInfo.fetchAll(
                    db,
                    sql: """
                        SELECT m.userId AS userId, u.displayName AS displayName, m.role AS role,
                               u.isAgent AS isAgent
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
        if token == suppressedToken { return nil } // Esc dismissed this token
        if token.first == "@" {
            guard query.count >= 1, !query.contains("@") else { return nil }
            let lower = query.lowercased()
            var items: [(String, String)] = ["channel", "here", "everyone"]
                .filter { $0.hasPrefix(lower) }
                .map { ("@\($0) ", "@\($0)") }
            items += members.value
                .filter { $0.userId != app.currentUser?.id && $0.displayName.lowercased().hasPrefix(lower) }
                .prefix(6)
                // agents get the 🤖 badge in the popup label; the insert stays the plain name
                .map { ("@\($0.displayName) ", "@\($0.displayName)\($0.isAgent == true ? " 🤖" : "")") }
            return Suggestions(kind: .mention, token: token, items: Array(items.prefix(8)))
        } else {
            guard query.count >= 2 else { return nil }
            let matches = EmojiCatalog.matches(query: query)
            return Suggestions(
                kind: .emoji,
                token: token,
                items: matches.map { ("\($0.emoji) ", "\($0.emoji) :\($0.code):") }
            )
        }
    }

    /// Vertical suggestion list floating above the composer card; first match
    /// pre-selected so Return inserts it (phase-3.5 fixes). ↑/↓ move, Esc
    /// dismisses — see handleCommand.
    private func suggestionBar(_ s: Suggestions) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(Array(s.items.enumerated()), id: \.offset) { index, item in
                    Button {
                        apply(s, item: item)
                    } label: {
                        HStack {
                            Text(item.label)
                                .flowFont(size: 13, weight: index == selectedSuggestion(s) ? .semibold : .regular)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            RoundedRectangle(cornerRadius: 6)
                                .fill(index == selectedSuggestion(s) ? MC.accent.opacity(0.12) : Color.clear)
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("composer.suggestion.\(item.label)")
                    .accessibilityAddTraits(index == selectedSuggestion(s) ? [.isSelected] : [])
                }
            }
        }
        .frame(maxWidth: 280, maxHeight: 160)
        .fixedSize(horizontal: false, vertical: true)
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(.white)
                .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
        )
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(MC.hairline2, lineWidth: 1))
    }

    private func selectedSuggestion(_ s: Suggestions) -> Int {
        min(suggestionIndex, max(0, s.items.count - 1))
    }

    private func apply(_ s: Suggestions, item: (insert: String, label: String)) {
        if let range = text.range(of: s.token, options: .backwards) {
            text.replaceSubrange(range, with: item.insert)
        }
        suggestionIndex = 0
        focusRequest += 1
    }

    /// Key routing while the suggestion list is visible (from the text view's
    /// doCommandBy hook). Return true = consumed.
    private func handleCommand(_ selector: Selector) -> Bool {
        // ↑ in an empty composer edits the last message (ui_nits item 4);
        // an empty draft can't have an autocomplete token, so no conflict.
        if selector == #selector(NSResponder.moveUp(_:)), text.isEmpty, let onEditLast {
            return onEditLast()
        }
        guard let s = autocomplete, !s.items.isEmpty else { return false }
        switch selector {
        case #selector(NSResponder.moveDown(_:)):
            suggestionIndex = (selectedSuggestion(s) + 1) % s.items.count
            return true
        case #selector(NSResponder.moveUp(_:)):
            suggestionIndex = (selectedSuggestion(s) + s.items.count - 1) % s.items.count
            return true
        case #selector(NSResponder.cancelOperation(_:)):
            suppressedToken = s.token
            return true
        case #selector(NSResponder.insertNewline(_:)) where NSApp.currentEvent?.modifierFlags.contains(.shift) != true,
             #selector(NSResponder.insertTab(_:)):
            apply(s, item: s.items[selectedSuggestion(s)])
            return true
        default:
            return false
        }
    }

    /// The one funnel every upload goes through — paperclip, image paste and
    /// drag-and-drop. `ImagePrep` belongs here rather than at each call site,
    /// the rule #84 settled on for iOS: it can't be forgotten by a new caller.
    /// Non-images and already-small images come back `nil` and upload untouched.
    private func uploadFiles(_ urls: [URL]) {
        guard let wsId = workspaceId else { return }
        uploading += urls.count
        for url in urls {
            Task { @MainActor in
                defer { uploading -= 1 }
                // Off the main actor: decoding and re-encoding a 12MP photo is
                // long enough to drop frames, and the composer stays live.
                let prepared = await Task.detached(priority: .userInitiated) {
                    ImagePrep.prepareForUpload(url)
                }.value
                defer { if let prepared { ImagePrep.discard(prepared) } }
                do {
                    let file = try await app.engine.uploadFile(
                        workspaceId: wsId, fileURL: prepared ?? url
                    )
                    if attachments.count < 10 { attachments.append(file) }
                } catch {
                    app.showError("Couldn't upload \(url.lastPathComponent): \(error.localizedDescription)")
                }
            }
        }
    }

    // MARK: - Attachments

    private var attachmentBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(attachments) { file in
                    if file.isImage {
                        // Real thumbnail preview in the prompt area (phase 5 item 4).
                        ZStack(alignment: .topTrailing) {
                            AuthImage(path: "/v1/files/\(file.id)/thumb") {
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(.secondary.opacity(0.1))
                            }
                            .scaledToFill()
                            .frame(width: 46, height: 46)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.quaternary, lineWidth: 1))
                            Button {
                                attachments.removeAll { $0.id == file.id }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .flowFont(size: 11)
                                    .foregroundStyle(.secondary)
                                    .background(Circle().fill(.white))
                            }
                            .buttonStyle(.plain)
                            .offset(x: 4, y: -4)
                        }
                        .padding(.top, 4)
                        .help(file.name)
                        .accessibilityIdentifier("composer.attachment.\(file.name)")
                    } else {
                        HStack(spacing: 4) {
                            Image(systemName: "doc")
                                .flowFont(.caption)
                            Text(file.name)
                                .flowFont(.caption)
                                .lineLimit(1)
                                .frame(maxWidth: 140)
                            Button {
                                attachments.removeAll { $0.id == file.id }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .flowFont(.caption)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(.secondary.opacity(0.12)))
                        .accessibilityIdentifier("composer.attachment.\(file.name)")
                    }
                }
                if uploading > 0 {
                    HStack(spacing: 4) {
                        ProgressView().controlSize(.mini)
                        Text("Uploading…").flowFont(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .frame(height: attachments.contains(where: \.isImage) ? 54 : 26)
    }

    private func pickFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.begin { response in
            guard response == .OK else { return }
            let urls = panel.urls
            Task { @MainActor in uploadFiles(urls) }
        }
    }

    // MARK: - Image paste (phase 3.5 item 3, via the NSTextView paste override)

    /// Called from MarkdownNSTextView.paste. Returns true when the pasteboard
    /// held images that were routed to the attachment flow (cap 10, shared
    /// uploading counter — same pipeline as the paperclip picker); false lets
    /// the text view paste normally (plain text).
    private func handlePasteImages(_ pasteboard: NSPasteboard) -> Bool {
        guard workspaceId != nil else { return false }
        let urls = Self.pastedImageFileURLs(from: pasteboard)
        guard !urls.isEmpty else { return false }
        uploadFiles(urls)
        return true
    }

    private static let pastedImageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "tiff", "tif", "heic", "bmp",
    ]

    /// Resolves pasteboard contents to local image file URLs. File URLs are
    /// used as-is (image extensions only); otherwise raw image data is
    /// written to a temp PNG (non-PNG data converted via NSBitmapImageRep).
    /// Returns [] for non-image content.
    private static func pastedImageFileURLs(from pasteboard: NSPasteboard) -> [URL] {
        if let urls = pasteboard.readObjects(
            forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]
        ) as? [URL], !urls.isEmpty {
            return urls.filter { pastedImageExtensions.contains($0.pathExtension.lowercased()) }
        }
        let types: [(NSPasteboard.PasteboardType, isPNG: Bool)] = [
            (.png, true), (.tiff, false), (NSPasteboard.PasteboardType("public.jpeg"), false),
        ]
        for (type, isPNG) in types {
            guard let data = pasteboard.data(forType: type) else { continue }
            let png = isPNG
                ? data
                : NSBitmapImageRep(data: data)?.representation(using: .png, properties: [:])
            guard let png else { continue }
            let epochMs = Int(Date().timeIntervalSince1970 * 1000)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("pasted-\(epochMs).png")
            do { try png.write(to: url) } catch { continue }
            return [url]
        }
        return []
    }

    // MARK: - Send

    private func send() {
        guard canSend else { return }
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = attachments
        text = ""
        attachments = []
        Task {
            // A clean send clears any stale invite banner; a send that mentions
            // non-members replaces it with the new list.
            missingMentions = await app.engine.sendMessage(
                channelId: channelId,
                body: body,
                threadRootId: threadRootId,
                attachments: files
            )
        }
    }

    // MARK: - Non-member mention CTA (web parity)

    /// Shown after sending a message that @-mentions someone not in this
    /// channel: they won't see the mention (an agent never processes it) until
    /// added. "Add to channel" invites them; re-mention to actually reach them.
    private var mentionInviteBanner: some View {
        let names = ListFormatter.localizedString(byJoining: missingMentions.map(\.name))
        let plural = missingMentions.count > 1
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(MC.muted)
            Text("\(names) \(plural ? "aren’t" : "isn’t") in this channel and won’t see your mention.")
                .flowFont(size: 12)
                .foregroundStyle(MC.muted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button("Add to channel") { addMissingToChannel() }
                .buttonStyle(.borderless)
                .flowFont(size: 12, weight: .semibold)
                .accessibilityIdentifier("composer.mention-invite.add")
            Button {
                missingMentions = []
            } label: {
                Image(systemName: "xmark")
                    .flowFont(size: 10, weight: .bold)
                    .foregroundStyle(MC.muted)
            }
            .buttonStyle(.plain)
            .help("Dismiss")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 8).fill(MC.accent.opacity(0.10)))
        .accessibilityIdentifier("composer.mention-nonmember-cta")
    }

    private func addMissingToChannel() {
        let toAdd = missingMentions
        missingMentions = []
        Task {
            for user in toAdd {
                do {
                    try await app.engine.addMember(channelId: channelId, userId: user.id)
                } catch {
                    app.showError("Couldn't add \(user.name): \(error.localizedDescription)")
                }
            }
        }
    }
}
