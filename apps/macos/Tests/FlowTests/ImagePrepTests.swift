import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import XCTest

@testable import Flow

/// #84: photos shared from the phone went up at full sensor resolution, and a
/// HEIC went up in a container the server can't thumbnail. These pin the rules
/// the fix rests on — cap the longest edge, convert what the server can't
/// read, and leave everything else exactly as it was.
final class ImagePrepTests: XCTestCase {
    private var scratch: URL!

    override func setUpWithError() throws {
        scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("ImagePrepTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: scratch)
    }

    // MARK: - Fixtures

    /// Writes a solid-colour image of the given size in the given container.
    @discardableResult
    private func makeImage(
        _ width: Int, _ height: Int, type: UTType, alpha: Bool = false, name: String = "shot"
    ) throws -> URL {
        let bitmapInfo = alpha
            ? CGImageAlphaInfo.premultipliedLast.rawValue
            : CGImageAlphaInfo.noneSkipLast.rawValue
        let ctx = try XCTUnwrap(CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: bitmapInfo
        ))
        ctx.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.9, alpha: alpha ? 0.5 : 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = try XCTUnwrap(ctx.makeImage())

        let ext = type.preferredFilenameExtension ?? "img"
        let url = scratch.appendingPathComponent("\(name).\(ext)")
        let sink = try XCTUnwrap(CGImageDestinationCreateWithURL(
            url as CFURL, type.identifier as CFString, 1, nil
        ))
        CGImageDestinationAddImage(sink, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(sink), "couldn't write \(type.identifier) fixture")
        return url
    }

    private func dimensions(_ url: URL) throws -> (width: Int, height: Int) {
        let src = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil))
        let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any])
        return (try XCTUnwrap(props[kCGImagePropertyPixelWidth] as? Int),
                try XCTUnwrap(props[kCGImagePropertyPixelHeight] as? Int))
    }

    private func containerType(_ url: URL) throws -> String {
        let src = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil))
        return try XCTUnwrap(CGImageSourceGetType(src) as String?)
    }

    // MARK: - Resize

    func testOversizedLandscapeCapsLongestEdgeAndKeepsAspect() throws {
        let out = try XCTUnwrap(ImagePrep.prepareForUpload(makeImage(4032, 3024, type: .jpeg)))
        let size = try dimensions(out)
        XCTAssertEqual(size.width, 1024, "longest edge must land on the cap")
        XCTAssertEqual(size.height, 768, "aspect ratio must survive the downscale")
    }

    /// The rule is longest-edge, not width-only: a portrait shot capped on
    /// width alone would still go up as 1024x4000.
    func testOversizedPortraitCapsHeightNotWidth() throws {
        let out = try XCTUnwrap(ImagePrep.prepareForUpload(makeImage(3024, 4032, type: .jpeg)))
        let size = try dimensions(out)
        XCTAssertEqual(size.height, 1024)
        XCTAssertEqual(size.width, 768)
        XCTAssertLessThanOrEqual(max(size.width, size.height), ImagePrep.maxEdgePx)
    }

    func testResizeActuallyShrinksTheFile() throws {
        let source = try makeImage(4032, 3024, type: .jpeg)
        let out = try XCTUnwrap(ImagePrep.prepareForUpload(source))
        let before = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: source.path)[.size] as? Int)
        let after = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int)
        XCTAssertLessThan(after, before, "the whole point of the ticket is fewer bytes on the wire")
    }

    // MARK: - Pass-through

    /// A web-friendly image already under the cap needs no work, and
    /// re-encoding it would cost quality for nothing.
    func testSmallJpegPassesThroughUntouched() throws {
        XCTAssertNil(ImagePrep.prepareForUpload(try makeImage(800, 600, type: .jpeg)))
    }

    func testSmallPngPassesThroughUntouched() throws {
        XCTAssertNil(ImagePrep.prepareForUpload(try makeImage(400, 400, type: .png)))
    }

    func testImageExactlyAtTheCapPassesThrough() throws {
        XCTAssertNil(ImagePrep.prepareForUpload(try makeImage(1024, 700, type: .jpeg)),
                     "the cap is inclusive — 1024 is not oversized")
    }

    func testNonImageFilePassesThrough() throws {
        let url = scratch.appendingPathComponent("notes.txt")
        try "not an image".write(to: url, atomically: true, encoding: .utf8)
        XCTAssertNil(ImagePrep.prepareForUpload(url))
    }

    // MARK: - Never enlarge

    /// A small HEIC converts because the server can't read the container, but
    /// it must convert at its own size — upscaling to the cap would invent
    /// pixels and inflate the upload.
    func testSmallUnsupportedFormatConvertsWithoutUpscaling() throws {
        let source = try makeImage(600, 400, type: .heic)
        let out = try XCTUnwrap(ImagePrep.prepareForUpload(source), "HEIC must be converted")
        let size = try dimensions(out)
        XCTAssertEqual(size.width, 600)
        XCTAssertEqual(size.height, 400)
    }

    // MARK: - Format

    func testHeicBecomesJpeg() throws {
        let out = try XCTUnwrap(ImagePrep.prepareForUpload(try makeImage(3000, 2000, type: .heic)))
        XCTAssertEqual(try containerType(out), UTType.jpeg.identifier)
        XCTAssertEqual(out.pathExtension, "jpeg")
    }

    /// JPEG can't carry alpha, so a transparent image must not be flattened
    /// onto a black background on its way up.
    func testTransparentImageStaysPng() throws {
        let out = try XCTUnwrap(ImagePrep.prepareForUpload(try makeImage(2000, 2000, type: .png, alpha: true)))
        XCTAssertEqual(try containerType(out), UTType.png.identifier)
    }

    func testConvertedFileKeepsItsOriginalBasename() throws {
        let out = try XCTUnwrap(ImagePrep.prepareForUpload(try makeImage(3000, 2000, type: .heic, name: "IMG_4821")))
        XCTAssertEqual(out.deletingPathExtension().lastPathComponent, "IMG_4821",
                       "the filename is what the attachment bar shows")
    }
}
