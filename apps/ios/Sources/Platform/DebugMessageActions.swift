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
struct DebugMessageActions: ViewModifier {
    let channelId: String
    let app: AppState
    @State private var ran = false

    func body(content: Content) -> some View {
        #if DEBUG
        content.task {
            guard !ran else { return }
            let env = ProcessInfo.processInfo.environment
            let react = env["FLOW_DEBUG_REACT"]
            let edit = env["FLOW_DEBUG_EDIT_LAST"]
            let delete = env["FLOW_DEBUG_DELETE_LAST"]
            guard react?.isEmpty == false || edit?.isEmpty == false || delete == "1"
            else { return }
            ran = true
            try? await Task.sleep(for: .seconds(2)) // let history load first
            let msg: Message? = try? await app.db.reader.read { db in
                try Message
                    .filter(Column("channelId") == channelId && Column("pending") == false)
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
        }
        #else
        content
        #endif
    }
}
