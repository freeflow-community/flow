import AVFoundation
import CoreImage
import Foundation

// A short H.264 clip for share-sheet QA (issue #219): 640x480, 5 s at 30 fps,
// with a bar that moves across the frame — so a posted *still* is obvious as a
// still, which is the failure mode video sharing has.
//
//   swift apps/ios/tools/make-test-video.swift /tmp/qa-share-219.mp4
//
// Here rather than ffmpeg because a QA machine is not guaranteed to have it,
// and AVFoundation ships with the OS.
let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/qa-share-219.mp4")
try? FileManager.default.removeItem(at: out)
let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 640, AVVideoHeightKey: 480,
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: 640, kCVPixelBufferHeightKey as String: 480,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

let ctx = CIContext()
for frame in 0..<150 {
    var pb: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
    let x = CGFloat(frame) / 150 * 540
    let image = CIImage(color: .init(red: 0.1, green: 0.2, blue: 0.5)).cropped(to: CGRect(x: 0, y: 0, width: 640, height: 480))
    let bar = CIImage(color: .init(red: 1, green: 0.8, blue: 0)).cropped(to: CGRect(x: x, y: 100, width: 100, height: 280))
    ctx.render(bar.composited(over: image), to: pb!)
    while !input.isReadyForMoreMediaData { usleep(1000) }
    adaptor.append(pb!, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 30))
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
print(writer.status == .completed ? "wrote \(out.path)" : "failed: \(String(describing: writer.error))")
