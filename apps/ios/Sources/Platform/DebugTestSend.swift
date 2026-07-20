import SwiftUI

/// DEBUG QA: FLOW_DEBUG_SEND=<text> posts one message via the exact code path
/// the composer uses (engine.sendMessage), so the send→server→cache→render
/// loop can be screenshot-verified without a UI text-input tool. One-shot.
struct DebugTestSend: ViewModifier {
    let channelId: String
    let app: AppState
    @State private var sent = false

    func body(content: Content) -> some View {
        #if DEBUG
        content.task {
            guard !sent,
                  let text = ProcessInfo.processInfo.environment["FLOW_DEBUG_SEND"], !text.isEmpty
            else { return }
            sent = true
            try? await Task.sleep(for: .seconds(2)) // let history load first
            await app.engine.sendMessage(channelId: channelId, body: text)
        }
        #else
        content
        #endif
    }
}
