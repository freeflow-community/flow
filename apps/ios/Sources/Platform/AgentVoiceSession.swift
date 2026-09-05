@preconcurrency import AVFoundation
@preconcurrency import Speech
import SwiftUI

/// Speech lifecycle for an ongoing one-to-one agent call.
///
/// Raw audio is consumed by iOS speech recognition and never enters Flow's
/// upload or message pipeline. A short pause completes each turn; the caller
/// posts the transcript as an ordinary message, feeds the durable agent reply
/// back here, and this session speaks it before listening again.
@MainActor
final class AgentVoiceSession: NSObject, ObservableObject {
    enum Phase: Equatable {
        case idle
        case requestingPermission
        case listening
        case ready
        case sending
        case waiting
        case speaking
        case failed
    }

    @Published var transcript = ""
    @Published private(set) var spokenReply = ""
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var errorMessage: String?
    @Published private(set) var awaitingAfterMessageId: String?
    @Published private(set) var callActive = false
    @Published private(set) var isMuted = false

    private let audioEngine = AVAudioEngine()
    private let synthesizer = AVSpeechSynthesizer()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var inputTapInstalled = false
    private var lastSpokenMessageId: String?
    private var endpointTask: Task<Void, Never>?
    private var debugTranscriptConsumed = false
    private var suspendedForBackground = false

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    var statusLabel: String {
        switch phase {
        case .idle: isMuted ? "Microphone off" : "Ready for the next turn"
        case .requestingPermission: "Connecting audio…"
        case .listening: "Listening…"
        case .ready: "Sending after your pause…"
        case .sending: "Sending your turn…"
        case .waiting: "Waiting for the agent…"
        case .speaking: "Speaking…"
        case .failed: errorMessage ?? "The call needs attention"
        }
    }

    /// Starts one persistent call. Listening stops only while the turn is sent,
    /// while the agent answers, while its reply is spoken, or when muted.
    func startCall() {
        guard !callActive else {
            resumeAfterForeground()
            return
        }
        callActive = true
        isMuted = false
        suspendedForBackground = false
        debugTranscriptConsumed = false
        errorMessage = nil
        spokenReply = ""
        beginListening()
    }

    func toggleMute() {
        guard callActive else { return }
        isMuted.toggle()
        if isMuted {
            if phase == .listening {
                finishCurrentUtterance()
            } else if phase == .requestingPermission {
                stopRecognitionHardware()
                deactivateAudioSession()
                phase = .idle
            }
        } else if phase == .idle {
            beginListening()
        }
    }

    func retry() {
        guard callActive else { return }
        errorMessage = nil
        if transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            phase = .idle
            if !isMuted { beginListening() }
        } else {
            phase = .ready
        }
    }

    func skipSpokenReply() {
        guard phase == .speaking else { return }
        phase = .idle
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        deactivateAudioSession()
        resumeListeningIfNeeded()
    }

    /// Speech recognition is intentionally foreground-only. The call itself
    /// stays active and reappears in the persistent bar when Flow returns.
    func suspendForBackground() {
        guard callActive else { return }
        suspendedForBackground = true
        if phase == .listening {
            finishCurrentUtterance()
        } else if phase == .requestingPermission {
            stopRecognitionHardware()
            deactivateAudioSession()
            phase = .idle
        }
    }

    func resumeAfterForeground() {
        suspendedForBackground = false
        resumeListeningIfNeeded()
    }

    private func beginListening() {
        guard callActive, !isMuted, !suspendedForBackground else { return }
        #if DEBUG
        if let injected = ProcessInfo.processInfo.environment["FLOW_DEBUG_AGENT_CALL_TRANSCRIPT"],
           !injected.isEmpty, !debugTranscriptConsumed {
            debugTranscriptConsumed = true
            transcript = injected
            spokenReply = ""
            errorMessage = nil
            phase = .listening
            if ProcessInfo.processInfo.environment["FLOW_DEBUG_AGENT_CALL_HOLD_TRANSCRIPT"] != "1" {
                scheduleEndpoint(after: .milliseconds(900))
            }
            return
        } else if ProcessInfo.processInfo.environment["FLOW_DEBUG_AGENT_CALL_TRANSCRIPT"] != nil,
                  debugTranscriptConsumed {
            phase = .idle
            return
        }
        #endif

        guard phase != .sending && phase != .waiting && phase != .requestingPermission else { return }
        stopSpeaking(setIdle: false)
        transcript = ""
        spokenReply = ""
        errorMessage = nil
        phase = .requestingPermission

        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            requestMicrophonePermission()
        case .notDetermined:
            // @Sendable keeps this closure nonisolated: without it, a closure
            // formed in a @MainActor class inherits main-actor isolation, and
            // TCC invokes the completion on a background queue — the runtime
            // isolation check then traps (EXC_BREAKPOINT) before the Task runs.
            SFSpeechRecognizer.requestAuthorization { @Sendable [weak self] status in
                Task { @MainActor in
                    guard let self else { return }
                    if status == .authorized {
                        self.requestMicrophonePermission()
                    } else {
                        self.fail("Speech recognition permission is required. Enable it in Settings → Flow.")
                    }
                }
            }
        default:
            fail("Speech recognition permission is required. Enable it in Settings → Flow.")
        }
    }

    private func requestMicrophonePermission() {
        guard callActive, !isMuted, !suspendedForBackground,
              phase == .requestingPermission else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            let outcome = await DeviceAccess.request(.audio)
            guard self.callActive, !self.isMuted, !self.suspendedForBackground,
                  self.phase == .requestingPermission else { return }
            switch outcome {
            case .granted:
                self.startRecognition()
            case .refused:
                self.fail("Microphone permission is required. Enable it in Settings → Flow.")
            case .unavailable:
                self.fail("Microphone access is unavailable on this device.")
            }
        }
    }

    private func startRecognition() {
        guard callActive, !isMuted, !suspendedForBackground,
              phase == .requestingPermission else { return }
        guard let recognizer = SFSpeechRecognizer(locale: .current), recognizer.isAvailable else {
            fail("Speech recognition is unavailable for the current language.")
            return
        }

        stopRecognitionHardware()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        recognitionRequest = request

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.defaultToSpeaker, .allowBluetoothHFP]
            )
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0 && format.channelCount > 0 else {
                fail("No microphone input is available.")
                return
            }
            input.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in
                request.append(buffer)
            }
            inputTapInstalled = true

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    guard let self, self.phase == .listening else { return }
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                        if result.isFinal {
                            self.finishCurrentUtterance()
                        } else if !self.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            self.scheduleEndpoint()
                        }
                    } else if error != nil {
                        if self.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            self.fail("I couldn't make out any speech. Please try again.")
                        } else {
                            self.finishCurrentUtterance()
                        }
                    }
                }
            }

            audioEngine.prepare()
            try audioEngine.start()
            phase = .listening
        } catch {
            stopRecognitionHardware()
            fail("The microphone couldn't start. Please try again.")
        }
    }

    private func finishCurrentUtterance() {
        stopRecognitionHardware()
        deactivateAudioSession()
        if transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            phase = .idle
            resumeListeningIfNeeded()
        } else {
            phase = .ready
        }
    }

    private func scheduleEndpoint(after delay: Duration = .milliseconds(1_400)) {
        endpointTask?.cancel()
        endpointTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(for: delay)
            } catch {
                return
            }
            guard let self, self.phase == .listening,
                  !self.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { return }
            self.finishCurrentUtterance()
        }
    }

    private func stopRecognitionHardware() {
        endpointTask?.cancel()
        endpointTask = nil
        if audioEngine.isRunning { audioEngine.stop() }
        if inputTapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            inputTapInstalled = false
        }
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
    }

    func markSending() {
        stopRecognitionHardware()
        deactivateAudioSession()
        errorMessage = nil
        phase = .sending
    }

    func waitForReply(after messageId: String) {
        transcript = ""
        errorMessage = nil
        awaitingAfterMessageId = messageId
        phase = .waiting
    }

    /// The first durable top-level agent row after the exact sent turn is its
    /// spoken answer. Ephemeral progress, failed echoes and system rows do not
    /// qualify.
    func considerReplies(_ messages: [Message], agentUserId: String) {
        guard phase == .waiting, let after = awaitingAfterMessageId else { return }
        guard let response = AgentCallReplyPolicy.response(
            in: messages,
            after: after,
            agentUserId: agentUserId
        ) else { return }
        guard response.id != lastSpokenMessageId else { return }
        lastSpokenMessageId = response.id
        awaitingAfterMessageId = nil
        speak(response.body)
    }

    func speak(_ body: String) {
        awaitingAfterMessageId = nil
        let text = AgentSpokenText.make(from: body)
        guard !text.isEmpty else {
            phase = .idle
            resumeListeningIfNeeded()
            return
        }
        stopSpeaking(setIdle: false)
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.defaultToSpeaker, .allowBluetoothHFP]
            )
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            fail("The reply arrived in chat, but audio playback couldn't start.")
            return
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.language.languageCode?.identifier)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        spokenReply = text
        phase = .speaking
        synthesizer.speak(utterance)
    }

    private func stopSpeaking(setIdle: Bool = true) {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        if setIdle && phase == .speaking { phase = .idle }
        if !audioEngine.isRunning { deactivateAudioSession() }
    }

    func fail(_ message: String) {
        stopRecognitionHardware()
        stopSpeaking(setIdle: false)
        awaitingAfterMessageId = nil
        errorMessage = message
        phase = .failed
    }

    func endCall() {
        callActive = false
        isMuted = false
        suspendedForBackground = false
        stopRecognitionHardware()
        phase = .idle
        stopSpeaking(setIdle: false)
        awaitingAfterMessageId = nil
        transcript = ""
        spokenReply = ""
        errorMessage = nil
        deactivateAudioSession()
    }

    private func resumeListeningIfNeeded() {
        guard callActive, !isMuted, !suspendedForBackground, phase == .idle else { return }
        beginListening()
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

extension AgentVoiceSession: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance
    ) {
        Task { @MainActor [weak self] in
            guard let self, self.phase == .speaking else { return }
            self.phase = .idle
            self.deactivateAudioSession()
            self.resumeListeningIfNeeded()
        }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didCancel utterance: AVSpeechUtterance
    ) {
        Task { @MainActor [weak self] in
            guard let self, self.phase == .speaking else { return }
            self.phase = .idle
            self.deactivateAudioSession()
            self.resumeListeningIfNeeded()
        }
    }
}

enum AgentCallEligibility {
    static func participantId(
        channelKind: String,
        memberIds: [String]?,
        currentUserId: String?,
        agentIds: Set<String>
    ) -> String? {
        guard channelKind == "dm", let currentUserId else { return nil }
        let others = (memberIds ?? []).filter { $0 != currentUserId }
        guard others.count == 1, agentIds.contains(others[0]) else { return nil }
        return others[0]
    }
}

enum AgentCallReplyPolicy {
    static func response(
        in messages: [Message],
        after messageId: String,
        agentUserId: String
    ) -> Message? {
        messages
            .filter {
                $0.id > messageId && $0.userId == agentUserId && $0.threadRootId == nil &&
                    $0.deletedAt == nil && $0.systemKind == nil && !$0.pending && !$0.failed &&
                    !$0.scheduled && !AgentStatus.isThinkingRow($0.body)
            }
            .min(by: { $0.id < $1.id })
    }
}

/// Turns a rich chat answer into bounded, natural speech. Code stays in chat
/// rather than being read character-by-character, and links keep their labels
/// without speaking tracking URLs.
enum AgentSpokenText {
    static func make(from markdown: String) -> String {
        var text = markdown
        var replacedCode = false
        if let regex = try? NSRegularExpression(pattern: "```[\\s\\S]*?```", options: []) {
            let range = NSRange(text.startIndex..., in: text)
            if regex.firstMatch(in: text, options: [], range: range) != nil {
                text = regex.stringByReplacingMatches(
                    in: text,
                    options: [],
                    range: range,
                    withTemplate: " I included the code in the chat. "
                )
                replacedCode = true
            }
        }
        text = replacing(pattern: "!\\[([^]]*)\\]\\([^)]+\\)", in: text, with: "$1")
        text = replacing(pattern: "\\[([^]]+)\\]\\([^)]+\\)", in: text, with: "$1")
        text = replacing(pattern: "<@[0-9a-fA-F-]{36}>", in: text, with: "you")
        text = replacing(pattern: "(?m)^#{1,6}\\s+", in: text, with: "")
        text = replacing(pattern: "(?m)^[-*+]\\s+", in: text, with: "")
        text = replacing(pattern: "[`*_~>]", in: text, with: "")
        text = replacing(pattern: "\\s+", in: text, with: " ")
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)

        let limit = 1_200
        if text.count > limit {
            let end = text.index(text.startIndex, offsetBy: limit)
            text = String(text[..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
                + ". The rest is in the chat."
        } else if replacedCode && text == "I included the code in the chat." {
            return text
        }
        return text
    }

    private static func replacing(pattern: String, in value: String, with template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { return value }
        return regex.stringByReplacingMatches(
            in: value,
            options: [],
            range: NSRange(value.startIndex..., in: value),
            withTemplate: template
        )
    }
}
