import GRDB
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Message composer: expanding text field + send, typing-indicator emission,
/// @-mention autocomplete (operator ruling: plain text + mention autocomplete
/// only on iOS — no live-styled fence composer), and attachments via the
/// photo library and the Files document picker (operator-ruled scope; camera
/// is a stretch goal). Shortcode and mention sugar still expand at send time
/// via SyncEngine.prepareOutgoing.
struct ComposerView: View {
    let channelId: String
    var threadRootId: String? = nil
    var placeholder: String = "Message"
    @EnvironmentObject var app: AppState
    @State private var text = ""
    @FocusState private var focused: Bool
    @StateObject private var members = DBObserved<[MemberRow]>(initial: [])
    @State private var workspaceId: String?
    @State private var attachments: [FileAttachment] = []
    @State private var uploading = 0
    @State private var showPhotoPicker = false
    @State private var showFilePicker = false
    @State private var showCamera = false
    @State private var photoSelection: [PhotosPickerItem] = []

    var body: some View {
        VStack(spacing: 0) {
            if let s = suggestions, !s.items.isEmpty {
                suggestionBar(s)
            }
            if !attachments.isEmpty || uploading > 0 {
                attachmentBar
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button {
                        showPhotoPicker = true
                    } label: {
                        Label("Photos & Videos", systemImage: "photo.on.rectangle")
                    }
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button {
                            showCamera = true
                        } label: {
                            Label("Camera", systemImage: "camera")
                        }
                    }
                    Button {
                        showFilePicker = true
                    } label: {
                        Label("Files", systemImage: "folder")
                    }
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(MC.faint)
                }
                .accessibilityIdentifier(threadRootId == nil ? "composer.attach" : "thread.composer.attach")

                TextField(placeholder, text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($focused)
                    .accessibilityIdentifier(threadRootId == nil ? "composer.input" : "thread.composer.input")
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 18).fill(MC.base))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(MC.hairline2))
                    .onSubmit(send)
                    .onChange(of: text) { _, newValue in
                        guard !newValue.isEmpty else { return }
                        Task { await app.engine.typing(channelId: channelId, threadRootId: threadRootId) }
                    }

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(canSend ? MC.send : MC.faint)
                }
                .disabled(!canSend)
                .accessibilityLabel("Send")
                .accessibilityIdentifier(threadRootId == nil ? "composer.send" : "thread.composer.send")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(MC.base)
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                uploadCameraShot(image)
            }
            .ignoresSafeArea()
        }
        .photosPicker(
            isPresented: $showPhotoPicker,
            selection: $photoSelection,
            maxSelectionCount: 10,
            matching: .any(of: [.images, .videos])
        )
        .onChange(of: photoSelection) { _, items in
            guard !items.isEmpty else { return }
            photoSelection = []
            uploadPhotos(items)
        }
        .fileImporter(
            isPresented: $showFilePicker,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true
        ) { result in
            if case .success(let urls) = result {
                uploadPickedFiles(urls)
            }
        }
        .task(id: channelId) {
            workspaceId = try? await app.db.reader.read { db in
                try String.fetchOne(
                    db,
                    sql: "SELECT workspaceId FROM channel WHERE id = ?",
                    arguments: [channelId]
                )
            }
            members.start(db: app.db, reset: []) { db in
                try MemberRow.fetchAll(
                    db,
                    sql: """
                        SELECT u.id AS userId, u.displayName AS displayName, u.isAgent AS isAgent
                        FROM member m JOIN user u ON u.id = m.userId
                        WHERE m.workspaceId = (SELECT workspaceId FROM channel WHERE id = ?)
                        ORDER BY u.displayName COLLATE NOCASE
                        """,
                    arguments: [channelId]
                )
            }
            #if DEBUG
            await debugUpload()
            #endif
        }
    }

    private var canSend: Bool {
        uploading == 0 &&
            (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
    }

    private func send() {
        guard canSend else { return }
        let body = text
        let files = attachments
        text = ""
        attachments = []
        Task {
            await app.engine.sendMessage(
                channelId: channelId, body: body, threadRootId: threadRootId, attachments: files
            )
        }
    }

    // MARK: - Uploads (shared pipeline: engine.uploadFile → attachment bar)

    /// Photo library picks. Videos pass through untouched (loaded as a file URL
    /// so a large movie never lands in memory); still images go through
    /// `ImagePrep` — HEIC re-encoded so server thumbnailing works, anything
    /// over 1024px on its longest edge downscaled.
    private func uploadPhotos(_ items: [PhotosPickerItem]) {
        for item in items {
            let isVideo = item.supportedContentTypes.contains { $0.conforms(to: .movie) }
            uploading += 1
            Task {
                defer { uploading -= 1 }
                if isVideo {
                    guard let movie = try? await item.loadTransferable(type: PickedMovie.self) else {
                        app.showError("Couldn't load the selected video")
                        return
                    }
                    await upload(movie.url)
                    return
                }
                guard let data = try? await item.loadTransferable(type: Data.self) else {
                    app.showError("Couldn't load the selected photo")
                    return
                }
                // Write the picked bytes out first and let ImagePrep decide
                // from the file itself — the picker's declared type isn't
                // always the container the bytes are actually in.
                let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "img"
                let epochMs = Int(Date().timeIntervalSince1970 * 1000)
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("photo-\(epochMs).\(ext)")
                guard (try? data.write(to: url)) != nil else {
                    app.showError("Couldn't read the selected photo")
                    return
                }
                await upload(url)
            }
        }
    }

    /// Camera capture (stretch goal): JPEG-encode and upload like a photo pick.
    private func uploadCameraShot(_ image: UIImage) {
        uploading += 1
        Task {
            defer { uploading -= 1 }
            guard let jpeg = image.jpegData(compressionQuality: 0.9) else {
                app.showError("Couldn't encode the captured photo")
                return
            }
            let epochMs = Int(Date().timeIntervalSince1970 * 1000)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("camera-\(epochMs).jpg")
            guard (try? jpeg.write(to: url)) != nil else {
                app.showError("Couldn't save the captured photo")
                return
            }
            await upload(url)
        }
    }

    /// Files app picks: security-scoped URLs copied to temp before reading.
    /// Images get the same ImagePrep treatment as a photo-library pick —
    /// a .heic picked here used to upload raw, so it arrived thumbnail-less.
    private func uploadPickedFiles(_ urls: [URL]) {
        for url in urls {
            uploading += 1
            Task {
                defer { uploading -= 1 }
                let scoped = url.startAccessingSecurityScopedResource()
                let tmp = FileManager.default.temporaryDirectory
                    .appendingPathComponent("picked-\(UUID().uuidString)", isDirectory: true)
                let copy = tmp.appendingPathComponent(url.lastPathComponent)
                do {
                    try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
                    try FileManager.default.copyItem(at: url, to: copy)
                } catch {
                    if scoped { url.stopAccessingSecurityScopedResource() }
                    app.showError("Couldn't read \(url.lastPathComponent): \(error.localizedDescription)")
                    return
                }
                if scoped { url.stopAccessingSecurityScopedResource() }
                await upload(copy)
            }
        }
    }

    /// The one funnel every upload path goes through — photo library, camera,
    /// Files picker and the debug QA harness. `ImagePrep` belongs here rather
    /// than at each call site: it can't be forgotten by a new caller, and the
    /// QA harness exercises the same code a real pick does. Non-images and
    /// already-small images come back `nil` and upload untouched.
    private func upload(_ fileURL: URL) async {
        guard let wsId = workspaceId else {
            app.showError("Couldn't upload: workspace unknown")
            return
        }
        let fileURL = ImagePrep.prepareForUpload(fileURL) ?? fileURL
        do {
            let file = try await app.engine.uploadFile(workspaceId: wsId, fileURL: fileURL)
            if attachments.count < 10 { attachments.append(file) }
        } catch {
            app.showError("Couldn't upload \(fileURL.lastPathComponent): \(error.localizedDescription)")
        }
    }

    /// DEBUG QA: FLOW_DEBUG_UPLOAD=<path>[,<path>…] routes host files through
    /// the exact composer upload pipeline, then FLOW_DEBUG_UPLOAD_SEND=<text>
    /// sends them — verifies upload → attach → send headlessly. One-shot,
    /// main-channel composer only.
    #if DEBUG
    private func debugUpload() async {
        let env = ProcessInfo.processInfo.environment
        guard threadRootId == nil,
              let paths = env["FLOW_DEBUG_UPLOAD"], !paths.isEmpty,
              !Self.debugUploadRan
        else { return }
        Self.debugUploadRan = true
        try? await Task.sleep(for: .seconds(2))
        for path in paths.split(separator: ",") {
            uploading += 1
            defer { uploading -= 1 }
            await upload(URL(fileURLWithPath: String(path)))
        }
        if let body = env["FLOW_DEBUG_UPLOAD_SEND"], !body.isEmpty {
            text = body
            send()
        }
    }
    private static var debugUploadRan = false
    #endif

    // MARK: - Attachment bar

    private var attachmentBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(attachments) { file in
                    if file.isImage {
                        ZStack(alignment: .topTrailing) {
                            AuthImage(path: "/v1/files/\(file.id)/thumb") {
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(.secondary.opacity(0.1))
                            }
                            .scaledToFill()
                            .frame(width: 52, height: 52)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.quaternary, lineWidth: 1))
                            removeButton(file)
                        }
                        .padding(.top, 6)
                        .accessibilityIdentifier("composer.attachment.\(file.name)")
                    } else {
                        HStack(spacing: 4) {
                            Image(systemName: "doc")
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
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(.secondary.opacity(0.12)))
                        .accessibilityIdentifier("composer.attachment.\(file.name)")
                    }
                }
                if uploading > 0 {
                    HStack(spacing: 4) {
                        ProgressView().controlSize(.mini)
                        Text("Uploading…").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 12)
        }
        .frame(height: attachments.contains(where: \.isImage) ? 62 : 32)
    }

    private func removeButton(_ file: FileAttachment) -> some View {
        Button {
            attachments.removeAll { $0.id == file.id }
        } label: {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .background(Circle().fill(.white))
        }
        .buttonStyle(.plain)
        .offset(x: 5, y: -5)
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
            // agents get the 🤖 badge in the chip label; the insert stays the plain name
            .map { ("@\($0.displayName) ", "@\($0.displayName)\($0.isAgent == true ? " 🤖" : "")") }
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
    var isAgent: Bool? // first-class AI agent → 🤖 badge
}

/// A video picked from the photo library, delivered as an on-disk file URL so a
/// large movie is copied to temp (via FileRepresentation) rather than loaded
/// into memory the way `loadTransferable(type: Data.self)` would.
private struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let epochMs = Int(Date().timeIntervalSince1970 * 1000)
            let dest = FileManager.default.temporaryDirectory
                .appendingPathComponent("video-\(epochMs)-\(received.file.lastPathComponent)")
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.copyItem(at: received.file, to: dest)
            return Self(url: dest)
        }
    }
}

/// Camera capture via UIImagePickerController (only offered when a camera
/// exists — the menu hides it on simulators/devices without one).
private struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                parent.onCapture(image)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

/// Typing indicator row (same 5s expiry semantics as web/macOS — the shared
/// AppState owns the map and expiry; this just renders it).
struct TypingIndicatorView: View {
    let channelId: String
    /// nil = the channel's main composer; set = that thread's composer, so the
    /// two never show each other's typists.
    var threadRootId: String? = nil
    let userNames: [String: String]
    @EnvironmentObject private var app: AppState

    var body: some View {
        let ids = app.typingUserIds(channelId: channelId, threadRootId: threadRootId)
        HStack {
            if !ids.isEmpty {
                Text(typingText(ids))
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

    /// An agent at work "thinks" rather than "types" (mirrors web/macOS).
    private func typingText(_ ids: [String]) -> String {
        let names = ids.map { userNames[$0] ?? "Someone" }
        switch ids.count {
        case 1:
            let verb = app.agentIds.contains(ids[0]) ? "thinking" : "typing"
            return "\(names[0]) is \(verb)…"
        case 2: return "\(names[0]) and \(names[1]) are typing…"
        default: return "Several people are typing…"
        }
    }
}
