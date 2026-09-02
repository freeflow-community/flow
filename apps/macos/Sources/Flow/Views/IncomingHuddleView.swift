import AVFoundation
import SwiftUI

/// The incoming-call card (#436) — Flow's whole answer to "someone is calling
/// you", and deliberately only that. There is no lock-screen answer, no
/// system call UI and no Recents entry: Track A rings a *live socket*, so this
/// card exists exactly while the app is open, which is exactly when the ring
/// reached you at all.
struct IncomingHuddleView: View {
    @EnvironmentObject private var app: AppState
    @State private var callerName = "Someone"
    @StateObject private var ringtone = Ringtone()

    var body: some View {
        if app.huddleAnsweredElsewhere {
            answeredElsewhere
        } else if let invite = app.incomingHuddleInvite {
            card(invite)
        }
    }

    private var answeredElsewhere: some View {
        HStack(spacing: 8) {
            Text("Answered on another device")
                .flowFont(size: 12)
                .foregroundStyle(MC.muted)
            Button {
                app.huddleAnsweredElsewhere = false
            } label: {
                Image(systemName: "xmark").flowFont(size: 10).foregroundStyle(MC.faint)
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(MC.base).shadow(radius: 12))
        .accessibilityIdentifier("huddle.answeredElsewhere")
    }

    private func card(_ invite: HuddleInvite) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                AvatarChip(
                    userId: invite.startedBy,
                    name: callerName,
                    avatarPath: app.avatarPaths[invite.startedBy],
                    size: 40,
                    radius: 999
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(callerName).flowFont(size: 13, weight: .semibold).foregroundStyle(MC.ink)
                    Text("is starting a huddle…").flowFont(size: 11).foregroundStyle(MC.muted)
                }
            }
            HStack(spacing: 8) {
                Button("Decline") { app.declineHuddleInvite() }
                    .accessibilityIdentifier("huddle.decline")
                Button("Accept") { app.acceptHuddleInvite() }
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("huddle.accept")
            }
        }
        .padding(14)
        .frame(width: 260)
        .background(RoundedRectangle(cornerRadius: 12).fill(MC.base).shadow(radius: 20))
        .task(id: invite.id) {
            callerName = (try? await app.db.reader.read { db in
                try User.fetchOne(db, key: invite.startedBy)?.displayName
            }) as? String ?? "Someone"
            ringtone.start()
        }
        .onDisappear { ringtone.stop() }
        .accessibilityIdentifier("huddle.incoming")
    }
}
