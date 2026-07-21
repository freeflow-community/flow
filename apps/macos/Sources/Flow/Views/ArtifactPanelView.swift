import AppKit
import AVKit
import PDFKit
import SwiftUI
import WebKit

// Phase 9: full content-pane viewer for an artifact (a personal bookmark of a
// file shared in chat). Renders images, video, PDF, HTML (sandboxed
// WKWebView), and text; anything else gets a download card — mirrors the web
// ArtifactView. The underlying file stays access-checked server-side.

struct ArtifactPanelView: View {
    let artifactId: String
    @EnvironmentObject private var app: AppState

    private var artifact: Artifact? {
        app.artifacts.first { $0.id == artifactId }
    }

    var body: some View {
        Group {
            if let artifact {
                VStack(spacing: 0) {
                    ArtifactHeaderView(artifact: artifact)
                    Rectangle().fill(MC.hairline).frame(height: 1)
                    ArtifactContentView(file: artifact.file)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .id(artifact.fileId)
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        // The artifact vanished (removed on another device / event raced the
        // list): fall back to the channel behind it.
        .onChange(of: artifact) { _, now in
            if now == nil { app.selectArtifact(nil) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("artifact.panel")
    }
}

/// Header: click-to-edit name (rename), file size, Download and Close.
private struct ArtifactHeaderView: View {
    let artifact: Artifact
    @EnvironmentObject private var app: AppState
    @State private var editing = false
    @State private var draft = ""
    @State private var busy = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            if editing {
                TextField("Artifact name", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 14, weight: .semibold))
                    .frame(maxWidth: 360)
                    .focused($nameFocused)
                    .onSubmit { saveRename() }
                    .onExitCommand { editing = false }
                    .accessibilityIdentifier("artifact.nameField")
            } else {
                Button {
                    draft = artifact.name
                    editing = true
                    nameFocused = true
                } label: {
                    Text(artifact.name)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(MC.ink)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                .help("Rename")
                .accessibilityIdentifier("artifact.title")
            }
            if busy { ProgressView().controlSize(.mini) }
            Spacer()
            Text(artifact.file.sizeLabel)
                .font(.caption)
                .foregroundStyle(MC.faint)
            Button(action: download) {
                Image(systemName: "arrow.down.to.line")
            }
            .help("Download")
            .accessibilityIdentifier("artifact.download")
            Button {
                app.selectArtifact(nil)
            } label: {
                Image(systemName: "xmark")
            }
            .help("Close")
            .accessibilityIdentifier("artifact.close")
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 22)
        .frame(height: 52)
    }

    private func saveRename() {
        let next = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        editing = false
        guard !next.isEmpty, next != artifact.name else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await app.engine.renameArtifact(id: artifact.id, name: next)
            } catch {
                app.showError("Couldn't rename artifact: \(error.localizedDescription)")
            }
        }
    }

    private func download() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let dest = try await app.engine.saveToDownloads(artifact.file)
                NSWorkspace.shared.activateFileViewerSelecting([dest])
            } catch {
                app.showError("Couldn't download \(artifact.file.name): \(error.localizedDescription)")
            }
        }
    }
}

/// Type routing, same order as the web panel (image → video → pdf → html →
/// text → download card).
private struct ArtifactContentView: View {
    let file: FileAttachment

    var body: some View {
        if file.mimeType.hasPrefix("image/") {
            ArtifactImagePane(file: file)
        } else if file.isVideo {
            if file.isPlayableVideo {
                ArtifactVideoPane(file: file)
            } else {
                // webm stays a download card: AVFoundation can't decode it
                // (same deliberate divergence as the chat card; Parity note).
                ArtifactDownloadPane(file: file)
            }
        } else if file.isPDF {
            ArtifactPdfPane(file: file)
        } else if file.isHTML {
            ArtifactHtmlPane(file: file)
        } else if file.isTextPreviewable {
            ArtifactTextPane(file: file)
        } else {
            ArtifactDownloadPane(file: file)
        }
    }
}

private struct ArtifactImagePane: View {
    let file: FileAttachment

    var body: some View {
        Group {
            // GIFs skip the static thumb path and animate from the original.
            if file.mimeType == "image/gif" {
                AnimatedAuthImage(path: "/v1/files/\(file.id)")
            } else {
                AuthImage(path: "/v1/files/\(file.id)") {
                    ProgressView()
                }
                .scaledToFit()
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MC.daypill.opacity(0.4))
        .accessibilityIdentifier("artifact.image.\(file.name)")
    }
}

/// Full-pane player. Downloads to disk first (streamed, not RAM) — same
/// whole-file strategy as the chat video card (Parity note re: streaming).
private struct ArtifactVideoPane: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var player: AVPlayer?
    @State private var failed = false

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
            } else if failed {
                ArtifactDownloadPane(file: file)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MC.ink.opacity(0.85))
        .accessibilityIdentifier("artifact.video.\(file.name)")
        .task(id: file.id) { await load() }
        .onDisappear { player?.pause() }
    }

    private func load() async {
        do {
            let url = try await app.engine.downloadFile(file)
            player = AVPlayer(url: url)
        } catch {
            failed = true
        }
    }
}

private struct ArtifactPdfPane: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var doc: PDFDocument?
    @State private var failed = false

    var body: some View {
        Group {
            if let doc {
                PDFKitView(document: doc)
            } else if failed {
                ArtifactDownloadPane(file: file)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityIdentifier("artifact.pdf.\(file.name)")
        .task(id: file.id) { await load() }
    }

    private func load() async {
        do {
            let url = try await app.engine.downloadFile(file)
            if let loaded = PDFDocument(url: url) {
                doc = loaded
            } else {
                failed = true
            }
        } catch {
            failed = true
        }
    }
}

/// Sandboxed HTML render (web parity with the sandboxed iframe): the bytes
/// are fetched through the authed API, then loaded as a string into an
/// isolated non-persistent WKWebView — no cookies and no baseURL, so the
/// document can never reach the session token or call the API as the user.
private struct ArtifactHtmlPane: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var html: String?
    @State private var failed = false

    var body: some View {
        Group {
            if let html {
                SandboxedHTMLView(html: html)
            } else if failed {
                ArtifactDownloadPane(file: file)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityIdentifier("artifact.html.\(file.name)")
        .task(id: file.id) {
            do {
                html = try await app.engine.fileText(file)
            } catch {
                failed = true
            }
        }
    }
}

/// WKWebView bridge with an ephemeral data store (no cookies/credentials).
private struct SandboxedHTMLView: NSViewRepresentable {
    let html: String

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.loadHTMLString(html, baseURL: nil)
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        // Content is static per artifact: the panel is re-created per file
        // (`.id(artifact.fileId)` upstream), so nothing to update in place.
    }
}

private struct ArtifactTextPane: View {
    /// Full-pane viewer, roomier than the chat preview's 100 KB cap.
    static let maxChars = 1_000_000

    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var text: String?
    @State private var failed = false

    var body: some View {
        Group {
            if let text {
                ScrollView([.horizontal, .vertical]) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(String(text.prefix(Self.maxChars)))
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(MC.ink)
                            .textSelection(.enabled)
                        if text.count > Self.maxChars {
                            Text("Showing the first 1 MB — Download for the full file.")
                                .font(.caption2)
                                .foregroundStyle(MC.faint)
                        }
                    }
                    .padding(.horizontal, 22)
                    .padding(.vertical, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if failed {
                ArtifactDownloadPane(file: file)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityIdentifier("artifact.text.\(file.name)")
        .task(id: file.id) {
            do {
                text = try await app.engine.fileText(file)
            } catch {
                failed = true
            }
        }
    }
}

/// Fallback card for types we can't render inline: click saves to
/// ~/Downloads and reveals in Finder (same behavior as the chat file chip).
private struct ArtifactDownloadPane: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var saving = false

    var body: some View {
        Button(action: save) {
            HStack(spacing: 8) {
                Text("📄")
                VStack(alignment: .leading, spacing: 1) {
                    Text(file.name)
                        .font(.callout.weight(.medium))
                        .foregroundStyle(MC.ink)
                        .lineLimit(1)
                    Text("\(file.sizeLabel) — click to download")
                        .font(.caption2)
                        .foregroundStyle(MC.muted)
                }
                if saving {
                    ProgressView().controlSize(.mini)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 10).fill(.white))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(MC.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("artifact.chip.\(file.name)")
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func save() {
        guard !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                let dest = try await app.engine.saveToDownloads(file)
                NSWorkspace.shared.activateFileViewerSelecting([dest])
            } catch {
                app.showError("Couldn't download \(file.name): \(error.localizedDescription)")
            }
        }
    }
}
