import Foundation

/// iOS stub for the macOS Banners helper. Local OS notifications are out of
/// scope for the initial iOS app (no APNs, no permission prompts), so these
/// are no-ops — in-app notification UI still works. The symbols exist because
/// the shared AppState/SyncEngine reference them.
enum Banners {
    @MainActor static func requestPermissionIfNeeded() {}
    static func show(title: String, body: String, id: String) {}
    @MainActor static func setBadge(_ count: Int) {}
}
