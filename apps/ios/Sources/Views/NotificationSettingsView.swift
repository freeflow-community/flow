import SwiftUI

/// Per-user notification preferences on iOS (#251, PUSH_APNS.md § *Suggested
/// phasing*, item 3) — the on-device consumer the toggles have never had here.
///
/// The prefs are server-side and always were: `suppressAlertFor` gates the
/// banner every client draws, and since #251 it gates the *push* too. Web has
/// had this screen since phase 10; the phone, which is the device most likely
/// to be in someone's pocket at midnight, had no way to turn a kind off.
///
/// Three things this screen deliberately does:
///
///  - **Absent means on.** Every key is optional server-side, so a switch reads
///    `!= false` rather than `== true`. A user who has never touched this
///    screen has an empty prefs object and every switch on, which is what the
///    server would do anyway.
///  - **One PATCH per flip**, carrying only the key that moved. The server
///    shallow-merges, so this cannot clobber a pref set on the laptop a second
///    earlier.
///  - **Optimistic, then reconciled.** The switch moves under the thumb and
///    reverts if the write fails — a toggle that waits for a round trip on a
///    phone's network feels broken.
struct NotificationSettingsView: View {
    @EnvironmentObject private var app: AppState
    @State private var prefs = NotificationPrefs()
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                toggle("Direct messages", "any message in a DM", \.dm, "dm")
                toggle("Mentions of me", "@you", \.mention, "mention")
                toggle("Group mentions", "@here, @channel", \.groupMention, "groupMention")
                toggle("Thread replies", "threads you started or joined", \.threadReply, "threadReply")
                toggle("Reactions", "someone reacts to your message", \.reaction, "reaction")
                toggle("Channel invites", "someone adds you to a channel", \.channelInvite, "channelInvite")
            } header: {
                Text("Alerts")
            } footer: {
                Text("Off means no banner and no push — everything still lands in Activity, and the badge still counts it.")
            }

            Section {
                toggle("Play a sound", "with every alert", \.sound, "sound")
            } header: {
                Text("Sound")
            } footer: {
                Text("Off still shows the banner. Your phone's ringer switch and Focus modes win over this either way.")
            }

            if let error {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("notifications.error")
                }
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("notifications.screen")
        .onAppear { prefs = app.currentUser?.prefs ?? NotificationPrefs() }
        // Another client's flip arrives as a new `currentUser`; adopt it unless
        // a write of ours is the thing that changed it (which already wrote the
        // same value locally).
        .onChange(of: app.currentUser?.notificationPrefs) { _, new in
            if let new { prefs = new }
        }
    }

    private func toggle(
        _ label: String,
        _ hint: String,
        _ key: WritableKeyPath<NotificationPrefs, Bool?>,
        _ id: String
    ) -> some View {
        Toggle(isOn: binding(key)) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.system(size: 15)).foregroundStyle(MC.ink)
                Text(hint).font(.caption2).foregroundStyle(MC.faint)
            }
        }
        .accessibilityIdentifier("notifications.\(id)")
    }

    private func binding(_ key: WritableKeyPath<NotificationPrefs, Bool?>) -> Binding<Bool> {
        Binding(
            get: { prefs[keyPath: key] != false },
            set: { on in set(key, on) }
        )
    }

    private func set(_ key: WritableKeyPath<NotificationPrefs, Bool?>, _ on: Bool) {
        let previous = prefs
        prefs[keyPath: key] = on
        error = nil
        // Only the key that moved goes on the wire.
        var delta = NotificationPrefs()
        delta[keyPath: key] = on
        Task {
            do {
                try await app.engine.setNotificationPrefs(delta)
            } catch {
                prefs = previous
                self.error = error.localizedDescription
            }
        }
    }
}
