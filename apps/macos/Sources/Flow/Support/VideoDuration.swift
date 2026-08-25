import AVFoundation
import Foundation

// Duration badges for video rows in the channel Files list (#347/#348).
//
// The server only thumbnails images, and it has no video decoder — so a
// duration has to come from the file itself. Downloading a video to read one
// number would be absurd for a 56pt row, so this goes through the presigned
// streaming URL: AVURLAsset range-requests the header, reads the duration, and
// stops. When the storage driver can't presign (local dev, legacy encrypted
// rows) there is no cheap answer and the row keeps its plain play badge —
// deliberately no fallback that pulls the bytes.

/// Response of GET /v1/files/:id/url — `url` is nil when the driver can't presign.
struct StreamUrlResponse: Decodable, Sendable {
    let url: String?
    let expiresInSeconds: Int
}

enum VideoDuration {
    /// Cache keyed by file id: the row is recycled on every scroll and the
    /// answer never changes for a given file. MainActor-bound like the other
    /// preview caches — only view bodies touch it.
    @MainActor private static let cache: NSCache<NSString, NSNumber> = {
        let c = NSCache<NSString, NSNumber>()
        c.countLimit = 500
        return c
    }()

    @MainActor static func cached(fileId: String) -> Double? {
        cache.object(forKey: fileId as NSString)?.doubleValue
    }

    @MainActor static func store(fileId: String, seconds: Double) {
        cache.setObject(NSNumber(value: seconds), forKey: fileId as NSString)
    }

    /// "0:42" / "1:05" / "1:02:03".
    static func label(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        let s = total % 60
        let m = (total / 60) % 60
        let h = total / 3600
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }

    /// Read a video's duration over the network without downloading it.
    /// Returns nil when there's no presigned URL or the header won't parse.
    static func seconds(streamURL: URL) async -> Double? {
        let asset = AVURLAsset(url: streamURL)
        guard let duration = try? await asset.load(.duration) else { return nil }
        let value = CMTimeGetSeconds(duration)
        return value.isFinite && value > 0 ? value : nil
    }
}
