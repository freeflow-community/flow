import Foundation
import UniformTypeIdentifiers

/// What the share sheet handed us, reduced to the two things v1 can post.
enum SharePayload {
    /// A file on disk, already through `ImagePrep`. Never image *bytes*: a
    /// share extension is killed near ~120 MB, and both `ImagePrep` and the
    /// presigned upload work from a file, so a 12 MP HEIC is never decoded
    /// whole (issue #214, failure mode 3).
    case image(URL)
    case text(String)

    var initialCaption: String {
        switch self {
        case .image: ""
        case .text(let text): text
        }
    }
}

/// Main-actor bound because `NSExtensionItem`/`NSItemProvider` are not
/// `Sendable`; the loads inside are still async, they just start from here.
@MainActor
enum ShareItemLoader {
    /// Picks the first thing we can post out of the sheet's attachments.
    /// Images win over links: sharing a web page offers both a URL and a
    /// preview image, and the URL is what the user meant.
    static func load(from items: [NSExtensionItem]) async -> SharePayload? {
        let providers = items.flatMap { $0.attachments ?? [] }

        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try? await loadURL(provider), !url.isFileURL {
                return .text(url.absoluteString)
            }
        }
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            if let file = try? await loadFile(provider, type: .image) {
                return .image(ImagePrep.prepareForUpload(file) ?? file)
            }
        }
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try? await loadText(provider), !text.isEmpty {
                return .text(text)
            }
        }
        return nil
    }

    private static func loadURL(_ provider: NSItemProvider) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, error in
                if let url = item as? URL {
                    continuation.resume(returning: url)
                } else {
                    continuation.resume(throwing: error ?? ShareError.unreadableItem)
                }
            }
        }
    }

    private static func loadText(_ provider: NSItemProvider) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, error in
                if let text = item as? String {
                    continuation.resume(returning: text)
                } else {
                    continuation.resume(throwing: error ?? ShareError.unreadableItem)
                }
            }
        }
    }

    /// `loadFileRepresentation`'s URL is only valid inside the callback, so the
    /// bytes are copied to our own temp directory before it returns.
    private static func loadFile(_ provider: NSItemProvider, type: UTType) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, error in
                guard let url else {
                    continuation.resume(throwing: error ?? ShareError.unreadableItem)
                    return
                }
                do {
                    let dir = FileManager.default.temporaryDirectory
                        .appendingPathComponent("share-\(UUID().uuidString)", isDirectory: true)
                    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    let copy = dir.appendingPathComponent(url.lastPathComponent)
                    try FileManager.default.copyItem(at: url, to: copy)
                    continuation.resume(returning: copy)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}

enum ShareError: LocalizedError {
    case unreadableItem
    case notSignedIn
    case nothingToShare

    var errorDescription: String? {
        switch self {
        case .unreadableItem: "Couldn't read the shared item."
        case .notSignedIn: "Open Flow and sign in first, then share again."
        case .nothingToShare: "Nothing here that Flow can post."
        }
    }
}
