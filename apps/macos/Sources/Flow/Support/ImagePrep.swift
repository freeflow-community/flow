// Image preparation for upload (issue #84): downscale oversized photos and
// re-encode formats the server can't thumbnail.
//
// Phone cameras produce 12MP HEIC, which is both far larger than any Flow view
// renders and a format `sharp` isn't configured to decode — an uploaded .heic
// lands with no thumbnail and no dimensions, so it renders as a generic file
// rather than an image. Both problems are fixed at the client, before the
// bytes go up: a server-side fix would still have eaten the full-size upload.
//
// ImageIO (not UIKit/AppKit) so the helper compiles for both clients, and
// because CGImageSourceCreateThumbnailAtIndex downsamples without ever
// decoding the full-resolution image into memory.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum ImagePrep {
    /// Longest-edge cap. Width-only would leave a portrait shot at 1024×4000 —
    /// same file-size problem, different axis.
    static let maxEdgePx = 1024

    /// JPEG quality for re-encodes. 0.85 is visually indistinguishable from
    /// the 0.9 the composer used before at meaningfully fewer bytes.
    static let jpegQuality = 0.85

    /// Formats the server thumbnails natively (`IMAGE_MIMES` in
    /// services/files.ts) — these only need re-encoding if they're oversized.
    static let passthroughTypes: Set<UTType> = [.png, .jpeg, .gif, .webP]

    /// Prepares an image for upload, returning a new temp-file URL — or `nil`
    /// when the file should be uploaded exactly as it is.
    ///
    /// `nil` is the common case and deliberately so: a 900px JPEG needs
    /// neither work, and re-encoding it would cost quality for nothing.
    /// Non-images, undecodable files and animations all pass through too.
    static func prepareForUpload(_ url: URL) -> URL? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let typeId = CGImageSourceGetType(source) as String?,
              let type = UTType(typeId),
              // ImageIO will happily open a video container and hand back its
              // first frame; without this a shared movie would upload as a
              // still. Only actual images are ours to touch.
              type.conforms(to: .image)
        else { return nil }  // not a decodable image — upload untouched

        // Animations lose every frame but the first through a thumbnail pass.
        guard CGImageSourceGetCount(source) == 1 else { return nil }

        guard let size = pixelSize(source) else { return nil }
        let longestEdge = max(size.width, size.height)

        let needsResize = longestEdge > maxEdgePx
        let needsConvert = !passthroughTypes.contains(type)
        guard needsResize || needsConvert else { return nil }

        // Cap, never enlarge: a 600px HEIC converts at 600px, not 1024.
        let target = min(maxEdgePx, longestEdge)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: target,
            // Bakes EXIF orientation into the pixels. Without it a photo shot
            // in portrait re-encodes sideways, because the orientation tag
            // doesn't survive to the output.
            kCGImageSourceCreateThumbnailWithTransform: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }

        // JPEG can't carry alpha, so anything transparent goes out as PNG
        // rather than getting a black background composited under it.
        let outputType: UTType = hasAlpha(source) ? .png : .jpeg
        let ext = outputType.preferredFilenameExtension ?? "jpg"
        let base = url.deletingPathExtension().lastPathComponent
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("FlowUpload-\(UUID().uuidString)", isDirectory: true)
        guard (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil
        else { return nil }
        let dest = dir.appendingPathComponent("\(base).\(ext)")

        guard let sink = CGImageDestinationCreateWithURL(
            dest as CFURL, outputType.identifier as CFString, 1, nil
        ) else { return nil }
        let destProps: [CFString: Any] = outputType == .jpeg
            ? [kCGImageDestinationLossyCompressionQuality: jpegQuality]
            : [:]
        CGImageDestinationAddImage(sink, image, destProps as CFDictionary)
        guard CGImageDestinationFinalize(sink) else { return nil }
        return dest
    }

    /// Deletes a temp file `prepareForUpload` produced, and the private
    /// directory it was written into. Only ever pass that return value: it
    /// removes the *enclosing directory*, which is ours alone.
    static func discard(_ url: URL) {
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }

    /// Pixel dimensions as displayed — swapped when EXIF orientation is one of
    /// the four rotated cases, so a portrait photo stored landscape-plus-tag
    /// measures portrait here and picks the right axis to cap.
    private static func pixelSize(_ source: CGImageSource) -> (width: Int, height: Int)? {
        guard let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = props[kCGImagePropertyPixelWidth] as? Int,
              let height = props[kCGImagePropertyPixelHeight] as? Int
        else { return nil }
        let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
        return (5...8).contains(orientation) ? (height, width) : (width, height)
    }

    /// Asks the *container*, not the decoded thumbnail. A decoded CGImage's
    /// `alphaInfo` describes the buffer layout the decoder happened to pick —
    /// HEIC decodes into an alpha-slotted buffer whether or not the photo is
    /// transparent — so reading it there sends every phone photo down the PNG
    /// path and inflates exactly the uploads this is meant to shrink.
    private static func hasAlpha(_ source: CGImageSource) -> Bool {
        guard let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        else { return false }
        return props[kCGImagePropertyHasAlpha] as? Bool ?? false
    }
}
