import AVFoundation
import Foundation
import XCTest

@testable import Flow

/// #96: the inline video player used to be pinned to a fixed 16:9 box, so a
/// portrait clip played as a sliver between two black pillars. These pin the
/// geometry rule the fix rests on — the aspect ratio out must equal the aspect
/// ratio in, whatever the bounds do.
final class VideoAspectTests: XCTestCase {
    private func ratio(_ s: CGSize) -> CGFloat { s.width / s.height }

    /// The inline card's bounds. Kept in sync with VideoAttachmentView.
    private func inline(_ w: CGFloat, _ h: CGFloat) -> CGSize {
        aspectFittedSize(CGSize(width: w, height: h), maxWidth: 480, maxHeight: 480)
    }

    func testWidescreenKeepsItsHistoricalSize() {
        // The common case must not move: 16:9 still lands on exactly 480x270.
        XCTAssertEqual(inline(1280, 720), CGSize(width: 480, height: 270))
    }

    func testPortraitIsTallNotPillarboxed() {
        let size = inline(720, 1280)
        XCTAssertEqual(size, CGSize(width: 270, height: 480))
        XCTAssertGreaterThan(size.height, size.width, "portrait clip must render taller than wide")
    }

    func testSquareAndUltrawideKeepTheirRatios() {
        XCTAssertEqual(inline(640, 640), CGSize(width: 480, height: 480))
        XCTAssertEqual(inline(1280, 536), CGSize(width: 480, height: 201))
    }

    func testRatioIsPreservedAcrossAWideRangeOfShapes() {
        for (w, h) in [(1920.0, 1080.0), (1080.0, 1920.0), (640.0, 640.0), (1280.0, 536.0),
                       (720.0, 480.0), (480.0, 720.0), (2560.0, 1080.0)] {
            let fitted = inline(w, h)
            XCTAssertEqual(
                ratio(fitted), ratio(CGSize(width: w, height: h)), accuracy: 0.01,
                "\(Int(w))x\(Int(h)) came out as \(Int(fitted.width))x\(Int(fitted.height))")
        }
    }

    func testSmallClipsAreNotUpscaledInline() {
        // Matches the inline-image rule: don't blow a small source up soft.
        XCTAssertEqual(inline(320, 240), CGSize(width: 320, height: 240))
    }

    func testLightboxUpscalesToFillTheSheet() {
        let size = aspectFittedSize(
            CGSize(width: 320, height: 240), maxWidth: 860, maxHeight: 620, allowUpscale: true)
        XCTAssertEqual(size, CGSize(width: 827, height: 620))
        XCTAssertEqual(ratio(size), 320.0 / 240.0, accuracy: 0.01)
    }

    func testLightboxPortraitFitsWithinTheSheetHeight() {
        let size = aspectFittedSize(
            CGSize(width: 720, height: 1280), maxWidth: 860, maxHeight: 620, allowUpscale: true)
        XCTAssertLessThanOrEqual(size.height, 620)
        XCTAssertEqual(ratio(size), 720.0 / 1280.0, accuracy: 0.01)
    }

    func testDegenerateSizeFallsBackToTheBounds() {
        XCTAssertEqual(
            aspectFittedSize(.zero, maxWidth: 480, maxHeight: 270),
            CGSize(width: 480, height: 270))
    }

    /// A rotated clip is the case that actually shipped broken on phones:
    /// iPhone portrait video is a landscape buffer plus a 90° transform, so
    /// reading `naturalSize` alone reports it the wrong way round.
    func testRotationTransformIsApplied() async throws {
        let url = try await Self.writeVideo(
            width: 640, height: 360, rotated: true, name: "rotated")
        defer { try? FileManager.default.removeItem(at: url) }
        let size = await videoPresentationSize(of: AVURLAsset(url: url))
        let unwrapped = try XCTUnwrap(size)
        XCTAssertEqual(unwrapped.width, 360, accuracy: 1)
        XCTAssertEqual(unwrapped.height, 640, accuracy: 1)
        XCTAssertGreaterThan(unwrapped.height, unwrapped.width, "90° clip must read as portrait")
    }

    func testUnrotatedClipReadsItsNaturalSize() async throws {
        let url = try await Self.writeVideo(
            width: 640, height: 360, rotated: false, name: "plain")
        defer { try? FileManager.default.removeItem(at: url) }
        let measured = await videoPresentationSize(of: AVURLAsset(url: url))
        let size = try XCTUnwrap(measured)
        XCTAssertEqual(size.width, 640, accuracy: 1)
        XCTAssertEqual(size.height, 360, accuracy: 1)
    }

    func testNonVideoAssetHasNoPresentationSize() async throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("issue96-not-a-video.mp4")
        try Data("definitely not an mp4".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let size = await videoPresentationSize(of: AVURLAsset(url: url))
        XCTAssertNil(size)
    }

    /// Minimal H.264 file, optionally carrying a 90° rotation like a phone's.
    private static func writeVideo(
        width: Int, height: Int, rotated: Bool, name: String
    ) async throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("issue96-\(name).mp4")
        try? FileManager.default.removeItem(at: url)
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
            ])
        if rotated { input.transform = CGAffineTransform(rotationAngle: .pi / 2) }
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32ARGB),
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
            ])
        writer.add(input)
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)
        for frame in 0..<3 {
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
            var buffer: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
            adaptor.append(buffer!, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 10))
        }
        input.markAsFinished()
        await writer.finishWriting()
        return url
    }
}
