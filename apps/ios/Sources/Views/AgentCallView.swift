import GRDB
import SwiftUI

/// Expanded controls and live captions for an ongoing agent call. Dismissing
/// the sheet only minimizes it; the app-level coordinator owns the call until
/// the red end button is tapped.
struct AgentCallView: View {
    let call: AgentCallCoordinator.ActiveCall
    @ObservedObject var session: AgentVoiceSession

    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var callCoordinator: AgentCallCoordinator
    @Environment(\.dismiss) private var dismiss
    @StateObject private var messages = DBObserved<[Message]>(initial: [])

    private var agent: User { call.agent }

    private var agentIsWorking: Bool {
        app.busyChannelIds.contains(call.channelId) ||
            app.typingUserIds(channelId: call.channelId).contains(agent.id)
    }

    private var thinkingMessage: Message? {
        messages.value.last(where: {
            $0.userId == agent.id && $0.deletedAt == nil && AgentStatus.isThinkingRow($0.body)
        })
    }

    private var isStopping: Bool {
        guard let row = thinkingMessage, let me = app.currentUser?.id else { return false }
        return row.reactions.contains {
            $0.emoji == AgentStatus.interruptEmoji && $0.userIds.contains(me)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Spacer(minLength: 24)
                agentIdentity
                Spacer(minLength: 28)
                voiceStatus
                liveCaption

                if let row = thinkingMessage {
                    interruptButton(row)
                        .padding(.top, 16)
                }

                if session.phase == .failed {
                    Button("Try again") { session.retry() }
                        .buttonStyle(.borderedProminent)
                        .tint(MC.accent)
                        .padding(.top, 16)
                        .accessibilityIdentifier("agentCall.retry")
                } else if session.phase == .speaking {
                    Button("Skip reply") { session.skipSpokenReply() }
                        .buttonStyle(.bordered)
                        .padding(.top, 16)
                        .accessibilityIdentifier("agentCall.skipReply")
                }

                Spacer(minLength: 24)
                callControls
                privacyNote
            }
            .padding(.horizontal, 24)
            .background(
                LinearGradient(
                    colors: [MC.accentSoft.opacity(0.09), MC.base, MC.base],
                    startPoint: .top,
                    endPoint: .center
                )
                .ignoresSafeArea()
            )
            .navigationTitle("Agent call")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        minimize()
                    } label: {
                        Image(systemName: "chevron.down")
                    }
                    .accessibilityLabel("Minimize call")
                    .accessibilityIdentifier("agentCall.minimize")
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task {
            messages.start(db: app.db, reset: []) { db in
                try Array(
                    Message
                        .filter(
                            Column("channelId") == call.channelId &&
                                Column("threadRootId") == nil
                        )
                        .order(Column("id").desc)
                        .limit(200)
                        .fetchAll(db)
                        .reversed()
                )
            }
        }
        .onDisappear { callCoordinator.minimize() }
    }

    private var agentIdentity: some View {
        VStack(spacing: 14) {
            ZStack(alignment: .bottomTrailing) {
                AvatarChip(
                    userId: agent.id,
                    name: agent.displayName,
                    avatarPath: app.avatarPaths[agent.id],
                    size: 112,
                    radius: 34
                )
                Text("🤖")
                    .font(.system(size: 23))
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(MC.base))
                    .overlay(Circle().stroke(MC.hairline2))
                    .offset(x: 7, y: 7)
            }

            VStack(spacing: 5) {
                Text(agent.displayName)
                    .font(.title2.weight(.bold))
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(callCoordinator.elapsedLabel(at: context.date))
                        .font(.system(.subheadline, design: .monospaced).weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("agentCall.agent")
    }

    private var voiceStatus: some View {
        HStack(spacing: 9) {
            if session.phase == .requestingPermission || session.phase == .sending ||
                session.phase == .waiting {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: statusSymbol)
                    .foregroundStyle(statusColor)
                    .symbolEffect(
                        .pulse,
                        isActive: session.phase == .listening || session.phase == .speaking
                    )
            }
            Text(statusText)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(session.phase == .failed ? Color.red : MC.ink)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 11)
        .background(Capsule().fill(MC.accentSoft.opacity(0.10)))
        .accessibilityIdentifier("agentCall.status")
    }

    private var statusText: String {
        if session.phase == .waiting && agentIsWorking { return "\(agent.displayName) is thinking…" }
        if session.phase == .ready && agentIsWorking { return "Finishing the previous turn…" }
        return session.statusLabel
    }

    private var statusSymbol: String {
        switch session.phase {
        case .listening: "waveform"
        case .speaking: "speaker.wave.2.fill"
        case .failed: "exclamationmark.triangle.fill"
        case .idle where session.isMuted: "mic.slash.fill"
        default: "phone.fill"
        }
    }

    private var statusColor: Color {
        switch session.phase {
        case .listening, .failed: .red
        default: MC.accent
        }
    }

    private var liveCaption: some View {
        VStack(spacing: 7) {
            if !session.transcript.isEmpty {
                Text("You")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(session.transcript)
                    .font(.title3)
                    .multilineTextAlignment(.center)
                    .lineLimit(5)
                    .accessibilityIdentifier("agentCall.caption")
            } else if session.phase == .speaking, !session.spokenReply.isEmpty {
                Text(agent.displayName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(session.spokenReply)
                    .font(.title3)
                    .multilineTextAlignment(.center)
                    .lineLimit(5)
                    .accessibilityIdentifier("agentCall.caption")
            } else {
                Text(captionPlaceholder)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("agentCall.caption")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 92)
        .padding(.horizontal, 10)
    }

    private var captionPlaceholder: String {
        if session.phase == .waiting || agentIsWorking {
            return "Your turn was sent. Stay on the call while \(agent.displayName) responds."
        }
        if session.isMuted { return "Unmute when you're ready to talk." }
        return "Just talk. A short pause sends your turn automatically."
    }

    private var callControls: some View {
        HStack(spacing: 28) {
            callControl(
                title: session.isMuted ? "Unmute" : "Mute",
                symbol: session.isMuted ? "mic.slash.fill" : "mic.fill",
                color: MC.accentSoft,
                identifier: "agentCall.mute"
            ) {
                session.toggleMute()
            }

            callControl(
                title: "End",
                symbol: "phone.down.fill",
                color: .red,
                identifier: "agentCall.end"
            ) {
                callCoordinator.end()
                dismiss()
            }

            callControl(
                title: "Minimize",
                symbol: "arrow.down.right.and.arrow.up.left",
                color: Color.secondary,
                identifier: "agentCall.minimizeControl"
            ) {
                minimize()
            }
        }
        .padding(.bottom, 22)
    }

    private func callControl(
        title: String,
        symbol: String,
        color: Color,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 58, height: 58)
                    .background(Circle().fill(color))
                Text(title)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(MC.ink)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }

    private func interruptButton(_ row: Message) -> some View {
        Button(role: .destructive) {
            guard !isStopping else { return }
            Task {
                await app.engine.toggleReaction(
                    messageId: row.id,
                    emoji: AgentStatus.interruptEmoji
                )
            }
        } label: {
            Label(isStopping ? "Stopping agent…" : "Stop agent task", systemImage: "stop.circle")
        }
        .buttonStyle(.bordered)
        .disabled(isStopping)
        .accessibilityIdentifier("agentCall.interrupt")
    }

    private var privacyNote: some View {
        Text("Only transcripts are sent to Flow. Audio is handled by iOS and may use Apple's speech service when on-device recognition is unavailable.")
            .font(.caption2)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.bottom, 8)
    }

    private func minimize() {
        callCoordinator.minimize()
        dismiss()
    }
}
