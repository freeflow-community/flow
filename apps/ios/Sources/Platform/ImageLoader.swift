import Foundation
import ImageIO
import SwiftUI
import UIKit

/// iOS port of the macOS ImageLoader: fetches authenticated images (avatars,
/// thumbnails) through the APIClient and memory-caches the decoded UIImage.
/// URLs are immutable per id, so the cache never needs invalidation.
/// Same interface AppState relies on: `shared`, `configure(api:)`, `image(path:)`.
actor ImageLoader {
    static let shared = ImageLoader()

    private var api: APIClient?
    // NSCache is internally thread-safe; `nonisolated(unsafe)` lets
    // `cachedImage(path:)` peek it synchronously from outside the actor.
    nonisolated(unsafe) private let cache = NSCache<NSString, UIImage>()
    private var inflight: [String: Task<UIImage?, Never>] = [:]

    func configure(api: APIClient) {
        self.api = api
        cache.countLimit = 500
    }

    /// Synchronous cache peek — lets a view seed its initial state with an
    /// already-cached image instead of always painting a placeholder for the
    /// first frame while the (actor-hopping) async load catches up.
    nonisolated func cachedImage(path: String) -> UIImage? {
        cache.object(forKey: path as NSString)
    }

    func image(path: String) async -> UIImage? {
        if let hit = cache.object(forKey: path as NSString) { return hit }
        if let task = inflight[path] { return await task.value }
        guard let api else { return nil }
        let task = Task<UIImage?, Never> {
            guard let data = try? await api.getData(path), let img = UIImage(data: data) else { return nil }
            return img
        }
        inflight[path] = task
        let img = await task.value
        inflight[path] = nil
        if let img { cache.setObject(img, forKey: path as NSString) }
        return img
    }

    /// Raw authenticated bytes (uncached) — used for animated GIF decoding.
    func data(path: String) async -> Data? {
        guard let api else { return nil }
        return try? await api.getData(path)
    }
}

/// SwiftUI wrapper: renders an authenticated remote image with a placeholder.
struct AuthImage<Placeholder: View>: View {
    let path: String
    @ViewBuilder let placeholder: () -> Placeholder
    @State private var image: UIImage?

    init(path: String, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.path = path
        self.placeholder = placeholder
        _image = State(initialValue: ImageLoader.shared.cachedImage(path: path))
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable()
            } else {
                placeholder()
            }
        }
        .task(id: path) {
            if let cached = ImageLoader.shared.cachedImage(path: path) {
                image = cached
                return
            }
            image = await ImageLoader.shared.image(path: path)
        }
    }
}

/// Animated GIF rendering: fetches original bytes and plays all frames via
/// UIImageView.animationImages (ImageIO decode). iOS counterpart of the
/// macOS AnimatedAuthImage (NSImageView-based).
struct AnimatedAuthImage: View {
    let path: String
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                AnimatedImageContainer(image: image)
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(.secondary.opacity(0.1))
                    .overlay(ProgressView().controlSize(.small))
            }
        }
        .task(id: path) {
            guard let data = await ImageLoader.shared.data(path: path) else { return }
            image = UIImage.animatedGIF(data) ?? UIImage(data: data)
        }
    }
}

private struct AnimatedImageContainer: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView(image: image)
        view.contentMode = .scaleAspectFit
        view.clipsToBounds = true
        // Let SwiftUI's frame win over the image's intrinsic size.
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .vertical)
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        view.image = image
    }
}

extension UIImage {
    /// Decodes multi-frame GIF data into an animated UIImage (per-frame
    /// delays summed; single-frame data falls back to a static image).
    static func animatedGIF(_ data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let count = CGImageSourceGetCount(source)
        guard count > 1 else { return UIImage(data: data) }
        var frames: [UIImage] = []
        var duration: Double = 0
        for i in 0..<count {
            guard let cg = CGImageSourceCreateImageAtIndex(source, i, nil) else { continue }
            let props = CGImageSourceCopyPropertiesAtIndex(source, i, nil) as? [CFString: Any]
            let gif = props?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            let delay = (gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double).flatMap { $0 > 0 ? $0 : nil }
                ?? (gif?[kCGImagePropertyGIFDelayTime] as? Double)
                ?? 0.1
            duration += max(delay, 0.02)
            frames.append(UIImage(cgImage: cg))
        }
        guard !frames.isEmpty else { return nil }
        return UIImage.animatedImage(with: frames, duration: duration)
    }
}
