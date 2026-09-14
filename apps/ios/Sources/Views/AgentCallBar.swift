import SwiftUI

/// Agent-call counterpart to `HuddleBar`: it is mounted outside
/// `ChannelScreen`, so minimizing or navigating never silently ends the call.
struct AgentCallBar: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var callCoordinator: AgentCallCoordinator

    var body: some View {
        if let call = callCoordinator.activeCall {
            AgentCallBarContent(call: call, session: callCoordinator.session)
        }
    }
}

private struct AgentCallBarContent: View {
    let call: AgentCallCoordinator.ActiveCall
    @ObservedObject var session: AgentVoiceSession

    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var callCoordinator: AgentCallCoordinator

    private var agentIsWorking: Bool {
        app.busyChannelIds.contains(call.channelId) ||
            app.typingUserIds(channelId: call.channelId).contains(call.agent.id)
    }

    var body: some View {
        HStack(spacing: 12) {
            Button {
                app.selectWorkspace(call.workspaceId)
                app.selectChannel(call.channelId)
                callCoordinator.show()
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: statusSymbol)
                        .symbolEffect(.pulse, isActive: session.phase == .listening || agentIsWorking)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Call with \(call.agent.displayName)")
                            .font(.system(size: 13, weight: .semibold))
                            .lineLimit(1)
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            Text("\(statusText) · \(callCoordinator.elapsedLabel(at: context.date))")
                                .font(.system(size: 11))
                                .foregroundStyle(MC.muted)
                        }
                    }
                }
                .foregroundStyle(MC.ink)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("agentCall.open")

            Spacer(minLength: 0)

            Button {
                session.toggleMute()
            } label: {
                Image(systemName: session.isMuted ? "mic.slash.fill" : "mic.fill")
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(MC.daypill))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(session.isMuted ? "Unmute" : "Mute")
            .accessibilityIdentifier("agentCall.mute")

            Button {
                callCoordinator.end()
            } label: {
                Image(systemName: "phone.down.fill")
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Color.red))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("End agent call")
            .accessibilityIdentifier("agentCall.end")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .background(MC.accent.opacity(0.1))
        .overlay(alignment: .top) { Divider() }
        .accessibilityIdentifier("agentCall.bar")
    }

    private var statusText: String {
        if session.phase == .waiting || session.phase == .sending || agentIsWorking {
            return "\(call.agent.displayName) is thinking"
        }
        switch session.phase {
        case .listening: return "Listening"
        case .speaking: return "\(call.agent.displayName) is speaking"
        case .failed: return "Needs attention"
        case .requestingPermission: return "Connecting audio"
        default: return session.isMuted ? "Muted" : "Call active"
        }
    }

    private var statusSymbol: String {
        switch session.phase {
        case .speaking: "speaker.wave.2.fill"
        case .failed: "exclamationmark.triangle.fill"
        default: session.isMuted ? "mic.slash.fill" : "waveform"
        }
    }
}
