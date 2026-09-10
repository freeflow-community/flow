import AppKit
import Foundation
import SwiftUI

/// Fetches authenticated images (thumbnails, avatars) through the APIClient
/// and memory-caches the decoded NSImage. File/thumb/avatar URLs are immutable
/// per id, so the cache never needs invalidation.
actor ImageLoader {
    static let shared = ImageLoader()

    private var api: APIClient?
    private var generation = 0
    // NSCache is internally thread-safe; `nonisolated(unsafe)` lets
    // `cachedImage(path:)` peek it synchronously from outside the actor.
    nonisolated(unsafe) private let cache = NSCache<NSString, NSImage>()
    private var inflight: [String: Task<NSImage?, Never>] = [:]

    func clear() {
        generation += 1
        for task in inflight.values { task.cancel() }
        inflight.removeAll()
        cache.removeAllObjects()
    }

    func configure(api: APIClient) {
        self.api = api
        cache.countLimit = 500
    }

    /// Synchronous cache peek — lets a view seed its initial state with an
    /// already-cached image instead of always painting a placeholder for the
    /// first frame while the (actor-hopping) async load catches up.
    nonisolated func cachedImage(path: String) -> NSImage? {
        cache.object(forKey: path as NSString)
    }

    func image(path: String) async -> NSImage? {
        if let hit = cache.object(forKey: path as NSString) { return hit }
        if let task = inflight[path] { return await task.value }
        guard let api else { return nil }
        let task = Task<NSImage?, Never> {
            guard let data = try? await api.getData(path), let img = NSImage(data: data) else { return nil }
            return img
        }
        let startedGeneration = generation
        inflight[path] = task
        let img = await task.value
        guard startedGeneration == generation else { return nil }
        inflight[path] = nil
        if let img { cache.setObject(img, forKey: path as NSString) }
        return img
    }
}

/// NSImageView-backed authenticated image that plays animated GIFs — SwiftUI's
/// Image renders only the first frame of a multi-frame NSImage; NSImageView
/// with `animates` plays them. Same load/cache path as AuthImage.
struct AnimatedAuthImage: NSViewRepresentable {
    @EnvironmentObject private var app: AppState
    let path: String

    func makeNSView(context: Context) -> NSImageView {
        let view = NSImageView()
        view.animates = true
        view.imageScaling = .scaleProportionallyUpOrDown
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .vertical)
        return view
    }

    func updateNSView(_ view: NSImageView, context: Context) {
        guard context.coordinator.loadedPath != path else { return }
        context.coordinator.loadedPath = path
        Task { @MainActor in
            view.image = await app.images.image(path: path)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator { var loadedPath: String? }
}

/// SwiftUI wrapper: renders an authenticated remote image with a placeholder.
struct AuthImage<Placeholder: View>: View {
    @EnvironmentObject private var app: AppState
    let path: String
    @ViewBuilder let placeholder: () -> Placeholder
    @State private var image: NSImage?

    init(path: String, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.path = path
        self.placeholder = placeholder
        _image = State(initialValue: nil)
    }

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable()
            } else {
                placeholder()
            }
        }
        .task(id: path) {
            if let cached = app.images.cachedImage(path: path) {
                image = cached
                return
            }
            image = await app.images.image(path: path)
        }
    }
}
