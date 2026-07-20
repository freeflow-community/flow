import GRDB
import SwiftUI

/// DEBUG QA: drive message actions on the newest message of the open channel
/// via the exact engine paths the long-press menu uses, so reactions/edit/
/// delete can be verified headlessly (no UI tap tool). One-shot per launch.
///
/// | Env var | Effect |
/// |---|---|
/// | `FLOW_DEBUG_REACT=<emoji>` | toggle that reaction on the newest message |
/// | `FLOW_DEBUG_EDIT_LAST=<text>` | edit the newest message body |
/// | `FLOW_DEBUG_DELETE_LAST=1` | delete the newest message |
/// | `FLOW_DEBUG_REPLY_LAST=<text>` | reply in thread to the newest root message |
/// | `FLOW_DEBUG_OPEN_THREAD_LAST=1` | push the thread screen for the newest threaded (else newest) message |
struct DebugMessageActions: ViewModifier {
    let channelId: String
    let app: AppState
    var openThread: (String) -> Void = { _ in }
    @State private var ran = false

    func body(content: Content) -> some View {
        #if DEBUG
        content.task {
            guard !ran else { return }
            let env = ProcessInfo.processInfo.environment
            let react = env["FLOW_DEBUG_REACT"]
            let edit = env["FLOW_DEBUG_EDIT_LAST"]
            let delete = env["FLOW_DEBUG_DELETE_LAST"]
            let reply = env["FLOW_DEBUG_REPLY_LAST"]
            let openLastThread = env["FLOW_DEBUG_OPEN_THREAD_LAST"]
            guard react?.isEmpty == false || edit?.isEmpty == false || delete == "1"
                || reply?.isEmpty == false || openLastThread == "1"
            else { return }
            ran = true
            try? await Task.sleep(for: .seconds(2)) // let history load first
            let msg: Message? = try? await app.db.reader.read { db in
                try Message
                    .filter(Column("channelId") == channelId && Column("pending") == false
                            && Column("threadRootId") == nil)
                    .order(Column("id").desc)
                    .fetchOne(db)
            }
            guard let msg else { return }
            if let react, !react.isEmpty {
                await app.engine.toggleReaction(messageId: msg.id, emoji: react)
            }
            if let edit, !edit.isEmpty {
                await app.engine.editMessage(id: msg.id, body: edit)
            }
            if delete == "1" {
                await app.engine.deleteMessage(id: msg.id)
            }
            if let reply, !reply.isEmpty {
                await app.engine.sendMessage(channelId: channelId, body: reply, threadRootId: msg.id)
            }
            if openLastThread == "1" {
                let threaded: Message? = try? await app.db.reader.read { db in
                    try Message
                        .filter(Column("channelId") == channelId && Column("replyCount") > 0)
                        .order(Column("id").desc)
                        .fetchOne(db)
                }
                openThread((threaded ?? msg).id)
            }
        }
        #else
        content
        #endif
    }
}
