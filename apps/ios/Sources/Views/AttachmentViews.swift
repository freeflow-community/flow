import QuickLook
import SwiftUI
import UIKit

/// Attachment rendering in chat (iOS-native equivalent of the phase-6
/// preview cards, per phase7.md — not a pixel port): image previews with
/// tap-to-lightbox, animated GIFs, and a file chip that opens everything
/// else (text, PDF, …) in a QuickLook preview with built-in share.
struct AttachmentView: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var showLightbox = false
    @State private var previewURL: URL?
    @State private var busy = false

    var body: some View {
        Group {
            if file.isImage {
                imageAttachment
            } else {
                fileChip
            }
        }
        .padding(.top, 3)
        .accessibilityIdentifier("msg.file.\(file.name)")
    }

    private var isGif: Bool { file.mimeType == "image/gif" }

    // MARK: image attachments

    private var imageAttachment: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(file.name)
                .font(.system(size: 11))
                .foregroundStyle(MC.faint)
                .lineLimit(1)
            Group {
                // GIFs skip the static webp thumb and animate from the original.
                if isGif {
                    AnimatedAuthImage(path: "/v1/files/\(file.id)")
                } else {
                    AuthImage(path: "/v1/files/\(file.id)/thumb") {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(.secondary.opacity(0.1))
                            .overlay(ProgressView().controlSize(.small))
                    }
                    .scaledToFit()
                }
            }
            .frame(width: displaySize.width, height: displaySize.height)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
            .onTapGesture { showLightbox = true }
        }
        .fullScreenCover(isPresented: $showLightbox) {
            ImageLightboxView(file: file)
        }
    }

    /// Sized to the phone content column (thumbs cap at 512px server-side).
    private var displaySize: CGSize {
        guard let w = file.width, let h = file.height, w > 0, h > 0 else {
            return CGSize(width: 240, height: 180)
        }
        let scale = min(1, 280 / CGFloat(w), 280 / CGFloat(h))
        return CGSize(width: max(60, CGFloat(w) * scale), height: max(60, CGFloat(h) * scale))
    }

    // MARK: non-image chip → QuickLook

    private var fileChip: some View {
        Button(action: openPreview) {
            HStack(spacing: 8) {
                Image(systemName: iconName)
                    .font(.title2)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(file.name)
                        .font(.callout)
                        .foregroundStyle(MC.ink)
                        .lineLimit(1)
                    Text(file.sizeLabel)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                if busy {
                    ProgressView().controlSize(.mini)
                }
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 8).fill(.secondary.opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.quaternary, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .quickLookPreview($previewURL)
    }

    private var iconName: String {
        switch file.mimeType {
        case let m where m.hasPrefix("image/"): "photo"
        case let m where m.hasPrefix("video/"): "film"
        case let m where m.hasPrefix("audio/"): "waveform"
        case "application/pdf": "doc.richtext"
        case "application/zip": "doc.zipper"
        case let m where m.hasPrefix("text/"): "doc.text"
        default: "doc"
        }
    }

    /// Downloads to a temp file (original filename preserved) and hands it to
    /// QuickLook — its viewer covers text/PDF/media and has share built in.
    private func openPreview() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                previewURL = try await app.engine.downloadFile(file)
            } catch {
                app.showError("Couldn't open \(file.name): \(error.localizedDescription)")
            }
        }
    }
}

/// Full-screen image viewer: original bytes, share (downloads then presents
/// the system share sheet — save to Photos, etc.), ✕ closes.
struct ImageLightboxView: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var shareItem: ShareFile?
    @State private var zoomed = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                ZoomableImageView(contentId: file.id, isZoomed: $zoomed) {
                    if file.mimeType == "image/gif" {
                        AnimatedAuthImage(path: "/v1/files/\(file.id)")
                    } else {
                        AuthImage(path: "/v1/files/\(file.id)") {
                            ProgressView().tint(.white)
                        }
                        .scaledToFit()
                    }
                }
                .accessibilityIdentifier("lightbox.image")
            }
            .navigationTitle(file.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityIdentifier("lightbox.close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: share) {
                        if busy {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                    .accessibilityIdentifier("lightbox.share")
                }
            }
        }
        .sheet(item: $shareItem) { item in
            ActivityView(items: [item.url])
        }
        .accessibilityIdentifier("lightbox")
    }

    private func share() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                shareItem = ShareFile(url: try await app.engine.downloadFile(file))
            } catch {
                app.showError("Couldn't download \(file.name): \(error.localizedDescription)")
            }
        }
    }
}

/// Internal, not private: the channel Files screen (#348) shares this rather
/// than growing a third copy of the same two types.
struct ShareFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

/// System share sheet wrapper.
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
