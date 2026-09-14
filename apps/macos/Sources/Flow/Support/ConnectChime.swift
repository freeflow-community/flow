import AVFoundation
import Foundation

/// The sound a Huddle makes when it actually connects (#509) — audible
/// confirmation to go with the visual one, for the very common case of a call
/// you started and then looked away from.
///
/// Generated rather than shipped as an asset, exactly as `Ringtone` is: a
/// fifth of a second of sine with a soft decay needs no file, no bundling and
/// no licence to reason about, and the provenance is this function. Lives in
/// Support because iOS compiles this layer too (apps/ios/project.yml).
///
/// On iOS the tone goes out through whatever audio session the call has
/// already set up, so it follows the call to the earpiece, the speaker or a
/// headset, and — like the ringtone — is not silenced by the ring switch
/// while a call is up.
@MainActor
enum ConnectChime {
    /// Held only for the length of the tone. An engine released mid-buffer
    /// plays nothing, so the completion handler is what lets it go.
    private static var live: (engine: AVAudioEngine, player: AVAudioPlayerNode)?

    static func play() {
        // A second chime landing on the first would be a glitch, not a chime.
        stop()
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        let format = engine.outputNode.inputFormat(forBus: 0)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        guard let buffer = makeBuffer(format: format) else { return }
        do {
            try engine.start()
        } catch {
            return // no audio device: the badge is still the answer
        }
        live = (engine, player)
        player.scheduleBuffer(buffer, at: nil, options: []) {
            Task { @MainActor in ConnectChime.stop() }
        }
        player.play()
    }

    private static func stop() {
        live?.player.stop()
        live?.engine.stop()
        live = nil
    }

    /// Two notes a fifth apart, the second overlapping the first's tail, with
    /// a ramped attack and an exponential decay — gating a sine on and off
    /// squarely is a click, which reads as a glitch rather than a chime. Well
    /// under a second in total, and quiet: this lands in the middle of a call
    /// somebody is listening to.
    private static func makeBuffer(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let sampleRate = format.sampleRate
        guard sampleRate > 0 else { return nil }
        let notes: [(hz: Double, at: Double)] = [(660, 0), (990, 0.09)]
        let duration = 0.22
        let total = 0.35
        let frames = AVAudioFrameCount(sampleRate * total)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buffer.frameLength = frames
        guard let channels = buffer.floatChannelData else { return nil }
        for frame in 0..<Int(frames) {
            let t = Double(frame) / sampleRate
            var value = 0.0
            for note in notes {
                let local = t - note.at
                guard local >= 0, local <= duration else { continue }
                let attack = min(local / 0.015, 1)
                let decay = exp(-local * 14)
                value += sin(2 * .pi * note.hz * local) * attack * decay
            }
            let sample = Float(value * 0.09)
            for channel in 0..<Int(format.channelCount) {
                channels[channel][frame] = sample
            }
        }
        return buffer
    }
}
