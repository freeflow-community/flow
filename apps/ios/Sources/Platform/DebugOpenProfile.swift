import GRDB
import SwiftUI

/// DEBUG QA: open a member's profile card (#223) without a UI tap tool.
///
/// | Env var | Effect |
/// |---|---|
/// | `FLOW_DEBUG_OPEN_MEMBER=<user id or name>` | open that member's card in the channel |
/// | `FLOW_DEBUG_OPEN_MEMBER_IN_THREAD=<user id or name>` | the same, from the thread screen |
///
/// The value matches a user id exactly, or a case-insensitive substring of a
/// display name. Two variables rather than one because the thread screen is
/// pushed over the channel screen: one variable would open both cards at once,
/// and the channel's would sit under the thread. The thread screen reaches
/// this only once `FLOW_DEBUG_OPEN_THREAD_LAST=1` has pushed it. One-shot per
/// launch of each screen.
struct DebugOpenProfile: ViewModifier {
    let app: AppState
    var envVar: String = "FLOW_DEBUG_OPEN_MEMBER"
    var openProfile: (String) -> Void = { _ in }
    @State private var ran = false

    func body(content: Content) -> some View {
        #if DEBUG
        content.task {
            guard !ran else { return }
            let env = ProcessInfo.processInfo.environment
            guard let key = env[envVar], !key.isEmpty else { return }
            ran = true
            try? await Task.sleep(for: .seconds(3)) // let history + users load
            let user: User? = try? await app.db.reader.read { db in
                if let exact = try User.filter(key: key).fetchOne(db) { return exact }
                return try User.fetchAll(db).first {
                    $0.displayName.range(of: key, options: .caseInsensitive) != nil
                }
            }
            guard let user else {
                NSLog("debugOpenProfile: no user matching \(key)")
                return
            }
            openProfile(user.id)
        }
        #else
        content
        #endif
    }
}
