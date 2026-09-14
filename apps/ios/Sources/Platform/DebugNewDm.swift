import GRDB
import SwiftUI

/// DEBUG QA: start a DM (#257) without a tap tool, in the same family as
/// `DebugOpenProfile` and `DebugTestSend`.
///
/// | Env var | Effect |
/// |---|---|
/// | `FLOW_DEBUG_OPEN_NEW_DM=1` | open the people picker from the drawer |
/// | `FLOW_DEBUG_NEW_DM=<person>[,<person>…]` | pick those people and press Start |
///
/// Each value matches a user id exactly, or a case-insensitive substring of a
/// display name — so one variable drives a 1:1 DM and a group DM alike. The
/// picker hook runs in the drawer, the create hook inside the sheet it opens,
/// which is what keeps `FLOW_DEBUG_NEW_DM` honest: it goes through the sheet's
/// own create path, not a direct engine call, so a broken sheet still fails.
/// One-shot per launch. Compiled out of release.
enum DebugNewDm {
    /// Resolve `<person>[,<person>…]` against the local user cache.
    static func resolve(_ spec: String, db: AppDatabase) async -> [String] {
        let keys = spec.split(separator: ",").map {
            $0.trimmingCharacters(in: .whitespaces)
        }.filter { !$0.isEmpty }
        guard !keys.isEmpty else { return [] }
        let users: [User] = (try? await db.reader.read { try User.fetchAll($0) }) ?? []
        return keys.compactMap { key in
            if let exact = users.first(where: { $0.id == key }) { return exact.id }
            return users.first {
                $0.displayName.range(of: key, options: .caseInsensitive) != nil
            }?.id
        }
    }
}

/// Opens the new-DM picker on the drawer's first appearance.
struct DebugOpenNewDm: ViewModifier {
    var open: () -> Void
    @State private var ran = false

    func body(content: Content) -> some View {
        #if DEBUG
        content.task {
            guard !ran,
                  ProcessInfo.processInfo.environment["FLOW_DEBUG_OPEN_NEW_DM"] == "1"
            else { return }
            ran = true
            try? await Task.sleep(for: .seconds(3)) // let the member roster load
            open()
        }
        #else
        content
        #endif
    }
}

/// Selects people in the open picker and presses Start.
struct DebugNewDmCreate: ViewModifier {
    let app: AppState
    var create: ([String]) -> Void
    @State private var ran = false

    func body(content: Content) -> some View {
        #if DEBUG
        content.task {
            guard !ran,
                  let spec = ProcessInfo.processInfo.environment["FLOW_DEBUG_NEW_DM"],
                  !spec.isEmpty
            else { return }
            ran = true
            try? await Task.sleep(for: .seconds(2))
            let ids = await DebugNewDm.resolve(spec, db: app.db)
            guard !ids.isEmpty else {
                NSLog("debugNewDm: no users matching \(spec)")
                return
            }
            create(ids)
        }
        #else
        content
        #endif
    }
}
