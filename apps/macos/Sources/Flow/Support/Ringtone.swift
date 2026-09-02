import AVFoundation
import Foundation

/// A looping ringtone for an incoming DM huddle (#436), generated rather than
/// shipped as an asset: two sine tones on a 4-second loop. A file would need
/// bundling, and a licence, for something a short buffer does — and this way
/// the tone stops precisely when the card goes away, with no half-played
/// player to chase.
///
/// Lives in Support rather than beside the macOS card because iOS shows the
/// same card and compiles this layer (see apps/ios/project.yml's sources) —
/// AVAudioEngine behaves the same on both.
@MainActor
final class Ringtone: ObservableObject {
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var timer: Timer?
    private var buffer: AVAudioPCMBuffer?

    func start() {
        guard engine == nil else { return }
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        let format = engine.outputNode.inputFormat(forBus: 0)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        guard let buffer = Self.makeBuffer(format: format) else { return }
        do {
            try engine.start()
        } catch {
            return // no audio device: the card is still the ring
        }
        self.engine = engine
        self.player = player
        self.buffer = buffer
        playOnce()
        timer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.playOnce() }
        }
    }

    private func playOnce() {
        guard let player, let buffer else { return }
        player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        player.play()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        player?.stop()
        engine?.stop()
        engine = nil
        player = nil
        buffer = nil
    }

    /// Two short tones with a smooth envelope — an abrupt gate on a sine is a
    /// click, which reads as a glitch rather than a ring.
    private static func makeBuffer(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let sampleRate = format.sampleRate
        let frames = AVAudioFrameCount(sampleRate * 1.0)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buffer.frameLength = frames
        guard let channels = buffer.floatChannelData else { return nil }
        for frame in 0..<Int(frames) {
            let t = Double(frame) / sampleRate
            let freq: Double = t < 0.45 ? 660 : 880
            let local = t < 0.45 ? t : t - 0.5
            // Silence between and after the two beeps.
            let envelope: Double
            if local < 0 || local > 0.4 {
                envelope = 0
            } else {
                envelope = min(local / 0.05, 1) * min((0.4 - local) / 0.05, 1)
            }
            let sample = Float(sin(2 * .pi * freq * t) * envelope * 0.12)
            for channel in 0..<Int(format.channelCount) {
                channels[channel][frame] = sample
            }
        }
        return buffer
    }
}
