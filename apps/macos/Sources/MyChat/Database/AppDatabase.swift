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
        let dir = support.appendingPathComponent("MyChat", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let pool = try DatabasePool(path: dir.appendingPathComponent("mychat.sqlite").path)
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
