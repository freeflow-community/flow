import SwiftUI

/// Navigation payload for opening someone's profile card.
struct ProfileRoute: Hashable, Identifiable {
    let userId: String
    var id: String { userId }
}

/// iOS port of the macOS member profile card
/// (`apps/macos/Sources/Flow/Views/PeopleViews.swift:138`): avatar, name,
/// status, agent marker + sponsor, website and bio — read-only. Editing your
/// own profile stays in `MyProfileView`; this is the view of *anyone*, which
/// iOS had no way to reach at all before (#223).
///
/// A sheet rather than a pushed screen: the card is a glance, and a thread is
/// already a pushed screen — pushing again would stack a third level under a
/// Back button labelled "Thread". macOS presents it as a sheet too.
struct MemberProfileSheet: View {
    let userId: String
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var user: User?
    @State private var sponsor: User?
    @State private var error: String?
    /// A DM create in flight, so the button can't be pressed twice.
    @State private var startingDm = false
    /// Measured height of the card's content. The sheet is sized to it, so a
    /// profile with no bio and no website is a short card rather than a half
    /// screen of white below three lines (#223, criterion 5).
    @State private var contentHeight: CGFloat = 300

    /// Inline navigation bar, which sits outside the measured content.
    private static let barHeight: CGFloat = 44

    /// Cached avatar path, so the card shows an image immediately for someone
    /// already on screen and doesn't wait on the fetch.
    private var avatarPath: String? {
        let path = user?.avatarUrl ?? app.avatarPaths[userId]
        return path?.hasPrefix("/v1/avatars/") == true ? path : nil
    }

    private var status: String? {
        guard let u = user else { return nil }
        let emoji = u.statusEmoji ?? ""
        let text = u.statusText ?? ""
        let line = "\(emoji) \(text)".trimmingCharacters(in: .whitespaces)
        return line.isEmpty ? nil : line
    }

    private var website: String? {
        guard let site = user?.website, !site.isEmpty else { return nil }
        return site
    }

    private var bio: String? {
        guard let text = user?.bio, !text.isEmpty else { return nil }
        return text
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    avatar
                    Text(user?.displayName ?? "…")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(MC.ink)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("profile.name")
                    if user?.isAgent == true {
                        Text("🤖 AI agent")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(MC.muted)
                            .accessibilityIdentifier("profile.agent")
                    }
                    if let sponsor {
                        sponsorRow(sponsor)
                    }
                    if let status {
                        Text(status)
                            .font(.system(size: 15))
                            .foregroundStyle(MC.inkSoft)
                            .multilineTextAlignment(.center)
                            .accessibilityIdentifier("profile.status")
                    }
                    if let email = user?.email {
                        Text(email)
                            .font(.system(size: 13))
                            .foregroundStyle(MC.muted)
                            .textSelection(.enabled)
                            .accessibilityIdentifier("profile.email")
                    }
                    if let tz = user?.timezone {
                        Text(localTimeLine(tz))
                            .font(.system(size: 13))
                            .foregroundStyle(MC.muted)
                            .accessibilityIdentifier("profile.localTime")
                    }
                    // The second way into a DM (#257), and the one that reads as
                    // an action on *this person* — macOS puts the same button
                    // on the same card (`PeopleViews.swift:207`).
                    if userId != app.currentUser?.id {
                        messageButton
                    }
                    // Website and bio are both optional and usually both empty.
                    // They live in one card that is simply absent when there is
                    // nothing to put in it, so an empty profile ends after the
                    // lines above rather than showing blank rows (#223).
                    if website != nil || bio != nil {
                        details
                    }
                    if let error {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("profile.error")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 28)
                .background(
                    GeometryReader { geo in
                        Color.clear
                            .onAppear { contentHeight = geo.size.height }
                            .onChange(of: geo.size.height) { _, new in contentHeight = new }
                    }
                )
            }
            .background(MC.base)
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("profile.done")
                }
            }
        }
        // A long bio still gets `.large` to expand into; the fitted detent is
        // just where the card opens.
        .presentationDetents([.height(contentHeight + Self.barHeight), .large])
        .presentationDragIndicator(.visible)
        .animation(.easeOut(duration: 0.2), value: contentHeight)
        .accessibilityIdentifier("profile.sheet")
        .task(id: userId) {
            do {
                let u = try await app.engine.fetchUser(userId)
                user = u
                // Agents carry a human sponsor; show who it is, as macOS does.
                if u.isAgent == true, let sid = u.sponsorId {
                    sponsor = try? await app.engine.fetchUser(sid)
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    /// "Message" — open the DM with this person, creating it if there isn't one.
    /// The server route dedupes by member set, so the existing conversation is
    /// what comes back for someone already messaged; there is nothing to check
    /// for first.
    private var messageButton: some View {
        Button {
            startDm()
        } label: {
            Label("Message", systemImage: "bubble.left.and.bubble.right")
                .font(.system(size: 15, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
        }
        .buttonStyle(.borderedProminent)
        .tint(MC.accent)
        .disabled(startingDm)
        .padding(.top, 4)
        .accessibilityIdentifier("profile.message")
    }

    private func startDm() {
        guard let wsId = app.selectedWorkspaceId else { return }
        startingDm = true
        error = nil
        Task {
            defer { startingDm = false }
            do {
                let ch = try await app.engine.createDm(workspaceId: wsId, userIds: [userId])
                dismiss()
                app.selectChannel(ch.id)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    /// Website + bio, when there is at least one of them.
    private var details: some View {
        VStack(alignment: .leading, spacing: 10) {
            // #220: the server stores http(s) URLs only, but re-check the
            // scheme before making it tappable — never hand an arbitrary
            // string to `Link`. A value that fails shows as plain text.
            if let site = website {
                Group {
                    if let url = safeWebsiteURL(site) {
                        Link(destination: url) {
                            Label(displayWebsite(site), systemImage: "link")
                                .font(.system(size: 15, weight: .semibold))
                        }
                    } else {
                        Label(site, systemImage: "link")
                            .font(.system(size: 15))
                            .foregroundStyle(MC.muted)
                    }
                }
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("profile.website")
            }
            if website != nil, bio != nil {
                Divider()
            }
            // Plain text, not markdown: SwiftUI Text renders it literally, and
            // the default wrapping keeps the author's line breaks.
            if let bio {
                Text(bio)
                    .font(.system(size: 15))
                    .foregroundStyle(MC.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("profile.bio")
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(.secondarySystemBackground))
        )
        .padding(.top, 6)
    }

    /// "Sponsored by <name>" chip for an agent's card.
    private func sponsorRow(_ s: User) -> some View {
        HStack(spacing: 6) {
            Text("Sponsored by")
                .font(.system(size: 12))
                .foregroundStyle(MC.muted)
            AvatarChip(
                userId: s.id,
                name: s.displayName,
                avatarPath: s.avatarUrl?.hasPrefix("/v1/avatars/") == true ? s.avatarUrl : nil,
                size: 18,
                radius: 9
            )
            Text(s.displayName)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(MC.inkSoft)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(Color(.secondarySystemBackground)))
        .accessibilityIdentifier("profile.sponsor")
    }

    /// The full-size image, not a scaled-up chip: the chip in the transcript is
    /// 38pt, and this is the one place the avatar is worth looking at.
    private var avatar: some View {
        Group {
            if let avatarPath {
                AuthImage(path: avatarPath) { initialsCircle }
                    .scaledToFill()
                    .frame(width: 96, height: 96)
                    .clipShape(Circle())
            } else {
                initialsCircle
            }
        }
        .accessibilityIdentifier("profile.avatar")
        .padding(.top, 4)
    }

    private var initialsCircle: some View {
        let (bg, fg) = MC.avatarColors(for: userId)
        return Circle()
            .fill(bg)
            .frame(width: 96, height: 96)
            .overlay(
                Text(initials)
                    .font(.system(size: 34, weight: .heavy))
                    .foregroundStyle(fg)
            )
    }

    private var initials: String {
        let parts = (user?.displayName ?? "?").split(separator: " ")
        let chars = parts.prefix(2).compactMap(\.first)
        return chars.isEmpty ? "?" : String(chars).uppercased()
    }

    /// The host and path, without the scheme — the link text people recognise.
    private func displayWebsite(_ site: String) -> String {
        site.replacingOccurrences(
            of: "^https?://", with: "", options: [.regularExpression, .caseInsensitive]
        )
    }

    private func localTimeLine(_ tzName: String) -> String {
        guard let tz = TimeZone(identifier: tzName) else { return tzName }
        let fmt = DateFormatter()
        fmt.timeZone = tz
        fmt.timeStyle = .short
        fmt.dateStyle = .none
        return "\(fmt.string(from: Date())) local time"
    }
}
