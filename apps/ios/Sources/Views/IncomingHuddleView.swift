import SwiftUI

/// The incoming-call card on a phone (#436) — an in-app sheet-style card, not
/// a system call screen. Track A rings a *live socket*, and an iOS socket is
/// only alive while Flow is in the foreground, so this card is shown exactly
/// when the ring reached the device at all. Lock-screen answering, CallKit and
/// Phone-app Recents are Track B.
///
/// The looping tone itself is `Ringtone` in the shared Support layer, which
/// both clients compile — the card differs per platform, the sound does not.
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
                .font(.system(size: 13))
                .foregroundStyle(MC.muted)
            Button {
                app.huddleAnsweredElsewhere = false
            } label: {
                Image(systemName: "xmark").font(.system(size: 12)).foregroundStyle(MC.faint)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12).fill(MC.base).shadow(radius: 12))
        .padding(.horizontal, 16)
        .accessibilityIdentifier("huddle.answeredElsewhere")
    }

    private func card(_ invite: HuddleInvite) -> some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                AvatarChip(
                    userId: invite.startedBy,
                    name: callerName,
                    avatarPath: app.avatarPaths[invite.startedBy],
                    size: 48,
                    radius: 999
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(callerName).font(.system(size: 16, weight: .semibold)).foregroundStyle(MC.ink)
                    Text("is starting a huddle…").font(.system(size: 13)).foregroundStyle(MC.muted)
                }
                Spacer()
            }
            HStack(spacing: 10) {
                Button {
                    app.declineHuddleInvite()
                } label: {
                    Text("Decline")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(RoundedRectangle(cornerRadius: 10).fill(MC.daypill))
                        .foregroundStyle(MC.ink)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("huddle.decline")

                Button {
                    app.acceptHuddleInvite()
                } label: {
                    Text("Accept")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(RoundedRectangle(cornerRadius: 10).fill(MC.accent))
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("huddle.accept")
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(MC.base).shadow(radius: 20))
        .padding(.horizontal, 16)
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
