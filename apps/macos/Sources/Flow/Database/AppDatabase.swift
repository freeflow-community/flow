import Foundation
import GRDB

/// Owns the local SQLite cache. All writes go through the SyncEngine;
/// SwiftUI observes via ValueObservation (see DBObserved).
struct AppDatabase: Sendable {
    let writer: any DatabaseWriter
    var reader: any DatabaseReader { writer }

    static func open() throws -> AppDatabase {
        let fm = FileManager.default
        let support = try fm.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true
        )
        let dir = support.appendingPathComponent(
            "Flow" + Profile.suffix, isDirectory: true
        )
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let pool = try DatabasePool(path: dir.appendingPathComponent("flow.sqlite").path)
        let db = AppDatabase(writer: pool)
        try db.migrate()
        return db
    }

    /// In-memory database (used by tests).
    static func inMemory() throws -> AppDatabase {
        let queue = try DatabaseQueue()
        let db = AppDatabase(writer: queue)
        try db.migrate()
        return db
    }

    private func migrate() throws {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1") { db in
            try db.create(table: "user") { t in
                t.column("id", .text).primaryKey()
                t.column("email", .text).notNull().defaults(to: "")
                t.column("displayName", .text).notNull().defaults(to: "")
                t.column("avatarUrl", .text)
                t.column("createdAt", .text)
            }
            try db.create(table: "workspace") { t in
                t.column("id", .text).primaryKey()
                t.column("slug", .text).notNull()
                t.column("name", .text).notNull()
                t.column("createdBy", .text).notNull()
                t.column("createdAt", .text).notNull()
                t.column("role", .text)
            }
            try db.create(table: "channel") { t in
                t.column("id", .text).primaryKey()
                t.column("workspaceId", .text).notNull().indexed()
                t.column("name", .text).notNull()
                t.column("topic", .text)
                t.column("isPrivate", .boolean).notNull().defaults(to: false)
                t.column("createdBy", .text).notNull()
                t.column("createdAt", .text).notNull()
                t.column("archivedAt", .text)
                t.column("isMember", .boolean).notNull().defaults(to: false)
                t.column("lastReadMsgId", .text)
                t.column("unreadCount", .integer).notNull().defaults(to: 0)
            }
            try db.create(table: "message") { t in
                t.column("id", .text).primaryKey()
                t.column("channelId", .text).notNull()
                t.column("userId", .text).notNull()
                t.column("threadRootId", .text)
                t.column("clientMsgId", .text).notNull()
                t.column("body", .text).notNull()
                t.column("createdAt", .text).notNull()
                t.column("editedAt", .text)
                t.column("deletedAt", .text)
                t.column("replyCount", .integer).notNull().defaults(to: 0)
                t.column("lastReplyAt", .text)
                t.column("pending", .boolean).notNull().defaults(to: false)
            }
            try db.create(index: "msg_channel_id", on: "message", columns: ["channelId", "id"])
            try db.create(index: "msg_thread_id", on: "message", columns: ["threadRootId", "id"])
            try db.create(index: "msg_client_id", on: "message", columns: ["channelId", "clientMsgId"])
            try db.create(table: "member") { t in
                t.column("workspaceId", .text).notNull()
                t.column("userId", .text).notNull()
                t.column("role", .text).notNull().defaults(to: "member")
                t.primaryKey(["workspaceId", "userId"])
            }
        }
        // Phase 2: DMs (kind/memberIds, nullable name), reactions/files on
        // messages (JSON columns), notify levels, user timezone. channel and
        // message are pure caches — cheapest correct migration is a rebuild;
        // history refetches on demand.
        migrator.registerMigration("v2") { db in
            try db.drop(table: "message")
            try db.drop(table: "channel")
            try db.create(table: "channel") { t in
                t.column("id", .text).primaryKey()
                t.column("workspaceId", .text).notNull().indexed()
                t.column("name", .text) // nil for DMs
                t.column("kind", .text).notNull().defaults(to: "standard")
                t.column("topic", .text)
                t.column("isPrivate", .boolean).notNull().defaults(to: false)
                t.column("createdBy", .text).notNull()
                t.column("createdAt", .text).notNull()
                t.column("archivedAt", .text)
                t.column("isMember", .boolean).notNull().defaults(to: false)
                t.column("lastReadMsgId", .text)
                t.column("unreadCount", .integer).notNull().defaults(to: 0)
                t.column("notifyLevel", .integer).notNull().defaults(to: 1)
                t.column("memberIds", .text) // JSON array, DMs only
            }
            try db.create(table: "message") { t in
                t.column("id", .text).primaryKey()
                t.column("channelId", .text).notNull()
                t.column("userId", .text).notNull()
                t.column("threadRootId", .text)
                t.column("clientMsgId", .text).notNull()
                t.column("body", .text).notNull()
                t.column("createdAt", .text).notNull()
                t.column("editedAt", .text)
                t.column("deletedAt", .text)
                t.column("replyCount", .integer).notNull().defaults(to: 0)
                t.column("lastReplyAt", .text)
                t.column("reactions", .text).notNull().defaults(to: "[]") // JSON
                t.column("files", .text).notNull().defaults(to: "[]") // JSON
                t.column("pending", .boolean).notNull().defaults(to: false)
            }
            try db.create(index: "msg_channel_id2", on: "message", columns: ["channelId", "id"])
            try db.create(index: "msg_thread_id2", on: "message", columns: ["threadRootId", "id"])
            try db.create(index: "msg_client_id2", on: "message", columns: ["channelId", "clientMsgId"])
            try db.alter(table: "user") { t in
                t.add(column: "timezone", .text)
            }
        }
        // Phase 2.5 (design 3a): user status emoji + label.
        migrator.registerMigration("v3") { db in
            try db.alter(table: "user") { t in
                t.add(column: "statusEmoji", .text)
                t.add(column: "statusText", .text)
            }
        }
        // Phase 3.5 (ruling 3): workspace-wide sidebar color preset id.
        migrator.registerMigration("v4") { db in
            try db.alter(table: "workspace") { t in
                t.add(column: "sidebarColor", .text)
            }
        }
        // Phase 5 (item 7): reply-avatar stack — first 4 distinct reply authors.
        migrator.registerMigration("v5") { db in
            try db.alter(table: "message") { t in
                t.add(column: "replyParticipantUserIds", .text).notNull().defaults(to: "[]") // JSON
            }
        }
        // First-class AI agents (AGENTS_DESIGN.md): 🤖 badge flag.
        migrator.registerMigration("v6") { db in
            try db.alter(table: "user") { t in
                t.add(column: "isAgent", .boolean)
            }
        }
        // Phase 11: link preview cards, cached with the message (JSON, like
        // reactions/files). Rows written before this default to "[]", so a
        // cached message just has no cards until it's refetched.
        migrator.registerMigration("v7") { db in
            try db.alter(table: "message") { t in
                t.add(column: "unfurls", .text).notNull().defaults(to: "[]") // JSON
            }
        }
        // Agents carry a human sponsor; the profile card shows it (ui_nits).
        migrator.registerMigration("v8") { db in
            try db.alter(table: "user") { t in
                t.add(column: "sponsorId", .text)
            }
        }
        // Optimistic-send failure: a send whose POST errored keeps its row and
        // flags it `failed` (Retry affordance) instead of spinning forever.
        migrator.registerMigration("v9") { db in
            try db.alter(table: "message") { t in
                t.add(column: "failed", .boolean).notNull().defaults(to: false)
            }
        }
        // Join/leave system messages (ui_nits): a non-null system_kind tags a row
        // as a channel event line ("Alice joined the channel"). NULL = a normal
        // message. Cached rows predate it and read as NULL until refetched.
        migrator.registerMigration("v10") { db in
            try db.alter(table: "message") { t in
                t.add(column: "systemKind", .text)
            }
        }
        // Sidebar badge semantics (operator ruling 2026-07-26): a number on a
        // channel row counts unread *notifications*, not unread messages —
        // messages only embolden the row. Cached rows read 0 until refetched.
        migrator.registerMigration("v11") { db in
            try db.alter(table: "channel") { t in
                t.add(column: "unreadNotifications", .integer).notNull().defaults(to: 0)
            }
        }
        try migrator.migrate(writer)
    }

    /// Removes all cached rows (used at sign-out).
    static func wipe(_ db: Database) throws {
        try db.execute(sql: "DELETE FROM message")
        try db.execute(sql: "DELETE FROM channel")
        try db.execute(sql: "DELETE FROM member")
        try db.execute(sql: "DELETE FROM workspace")
        try db.execute(sql: "DELETE FROM user")
    }
}
