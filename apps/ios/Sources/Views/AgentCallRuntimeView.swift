import GRDB
import SwiftUI

/// Keeps listen → send → answer → listen alive while the expanded sheet is
/// minimized or the user navigates elsewhere in Flow.
struct AgentCallRuntimeView: View {
    @EnvironmentObject private var callCoordinator: AgentCallCoordinator

    var body: some View {
        if let call = callCoordinator.activeCall {
            AgentCallRuntime(call: call, session: callCoordinator.session)
                .environmentObject(callCoordinator)
        }
    }
}

private struct AgentCallRuntime: View {
    let call: AgentCallCoordinator.ActiveCall
    @ObservedObject var session: AgentVoiceSession

    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var callCoordinator: AgentCallCoordinator
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var messages = DBObserved<[Message]>(initial: [])

    private var agentIsWorking: Bool {
        app.busyChannelIds.contains(call.channelId) ||
            app.typingUserIds(channelId: call.channelId).contains(call.agent.id)
    }

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
            .task(id: call.channelId) {
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
                session.resumeAfterForeground()
                sendReadyTurnIfPossible()
            }
            .onChange(of: session.phase) { _, _ in
                sendReadyTurnIfPossible()
            }
            .onChange(of: messages.value) { _, list in
                session.considerReplies(list, agentUserId: call.agent.id)
                sendReadyTurnIfPossible()
            }
            .onChange(of: agentIsWorking) { _, _ in
                sendReadyTurnIfPossible()
            }
            .onChange(of: app.connection) { _, _ in
                sendReadyTurnIfPossible()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    session.resumeAfterForeground()
                } else {
                    session.suspendForBackground()
                }
            }
    }

    private func sendReadyTurnIfPossible() {
        guard callCoordinator.activeCall?.channelId == call.channelId,
              session.phase == .ready,
              app.connection == .connected,
              !agentIsWorking
        else { return }

        let body = session.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, app.currentUser != nil else { return }
        let baseline = messages.value.last?.id
        session.markSending()

        Task {
            guard let receipt = await app.engine.sendMessageWithReceipt(
                channelId: call.channelId,
                body: body
            ) else {
                session.fail("Your turn couldn't be added to the conversation.")
                return
            }
            guard callCoordinator.activeCall?.channelId == call.channelId,
                  session.callActive
            else { return }
            guard receipt.delivered else {
                session.fail("Your turn couldn't be delivered. Check your connection and retry.")
                return
            }

            session.waitForReply(after: max(receipt.messageId, baseline ?? receipt.messageId))
            session.considerReplies(messages.value, agentUserId: call.agent.id)

            #if DEBUG
            if let reply = ProcessInfo.processInfo.environment["FLOW_DEBUG_AGENT_CALL_REPLY"],
               !reply.isEmpty {
                session.speak(reply)
            }
            #endif
        }
    }
}
