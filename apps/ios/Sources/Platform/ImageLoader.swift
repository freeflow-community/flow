import Foundation
import SwiftUI
import UIKit

/// iOS port of the macOS ImageLoader: fetches authenticated images (avatars,
/// thumbnails) through the APIClient and memory-caches the decoded UIImage.
/// URLs are immutable per id, so the cache never needs invalidation.
/// Same interface AppState relies on: `shared`, `configure(api:)`, `image(path:)`.
actor ImageLoader {
    static let shared = ImageLoader()

    private var api: APIClient?
    private let cache = NSCache<NSString, UIImage>()
    private var inflight: [String: Task<UIImage?, Never>] = [:]

    func configure(api: APIClient) {
        self.api = api
        cache.countLimit = 500
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
}

/// SwiftUI wrapper: renders an authenticated remote image with a placeholder.
struct AuthImage<Placeholder: View>: View {
    let path: String
    @ViewBuilder let placeholder: () -> Placeholder
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable()
            } else {
                placeholder()
            }
        }
        .task(id: path) {
            image = await ImageLoader.shared.image(path: path)
        }
    }
}
