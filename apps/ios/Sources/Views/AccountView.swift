import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// My own avatar path: `currentUser.avatarUrl` first so a fresh upload shows
/// immediately, falling back to the published map used for everyone else.
extension AppState {
    var myAvatarPath: String? {
        guard let me = currentUser else { return nil }
        return me.avatarUrl ?? avatarPaths[me.id]
    }
}

/// iOS port of the web/macOS avatar-menu + status picker (design 3a's profile
/// footer). On a phone there is no persistent sidebar, so the affordance lives
/// in the nav bar's top-right corner: an avatar button (with the status emoji
/// badge) that opens a sheet holding the profile summary, the canned status
/// list, "My Profile…" and Sign Out.
struct AccountToolbarButton: View {
    @EnvironmentObject private var app: AppState
    @State private var showAccount = false

    private var statusEmoji: String { app.currentUser?.statusEmoji ?? "" }

    var body: some View {
        Button {
            showAccount = true
        } label: {
            AvatarChip(
                userId: app.currentUser?.id ?? "",
                name: app.currentUser?.displayName ?? "?",
                avatarPath: app.myAvatarPath,
                size: 30,
                radius: 9
            )
            .overlay(alignment: .bottomTrailing) {
                if !statusEmoji.isEmpty {
                    Text(statusEmoji)
                        .font(.system(size: 10))
                        .frame(width: 16, height: 16)
                        .background(Circle().fill(MC.base))
                        .overlay(Circle().strokeBorder(MC.hairline, lineWidth: 1))
                        .offset(x: 5, y: 5)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("account.button")
        .accessibilityLabel("Account")
        .sheet(isPresented: $showAccount) { AccountSheet() }
    }
}

/// The avatar button's sheet: who you are, your status, profile, sign out.
struct AccountSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false

    private var statusEmoji: String { app.currentUser?.statusEmoji ?? "" }
    private var statusText: String { app.currentUser?.statusText ?? "" }

    var body: some View {
        NavigationStack {
            List {
                Section { header }

                Section("Set your status") {
                    ForEach(Array(MC.statusOptions.enumerated()), id: \.offset) { index, option in
                        Button {
                            setStatus(option.emoji, option.text, option.suppresses)
                        } label: {
                            HStack(spacing: 10) {
                                Text(option.emoji).font(.system(size: 18)).frame(width: 24)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(option.text)
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(MC.ink)
                                    if option.suppresses {
                                        Text("Pauses notifications")
                                            .font(.caption2)
                                            .foregroundStyle(MC.faint)
                                    }
                                }
                                Spacer(minLength: 0)
                                if option.emoji == statusEmoji, option.text == statusText {
                                    Image(systemName: "checkmark")
                                        .font(.footnote.bold())
                                        .foregroundStyle(MC.accentSoft)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .disabled(busy)
                        .accessibilityIdentifier("status.option.\(index + 1)")
                    }
                    if !statusEmoji.isEmpty || !statusText.isEmpty {
                        Button {
                            setStatus("", "", false)
                        } label: {
                            Text("Clear status")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(MC.faint)
                        }
                        .disabled(busy)
                        .accessibilityIdentifier("status.clear")
                    }
                }

                Section {
                    NavigationLink {
                        MyProfileView()
                    } label: {
                        Label("My Profile…", systemImage: "person.crop.circle")
                    }
                    .accessibilityIdentifier("account.profile")

                    Button(role: .destructive) {
                        dismiss()
                        Task { await app.engine.logout() }
                    } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    .accessibilityIdentifier("account.signOut")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("You")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .accessibilityIdentifier("account.sheet")
    }

    private var header: some View {
        HStack(spacing: 12) {
            AvatarChip(
                userId: app.currentUser?.id ?? "",
                name: app.currentUser?.displayName ?? "?",
                avatarPath: app.myAvatarPath,
                size: 52,
                radius: 14
            )
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(app.currentUser?.displayName ?? "You")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(MC.ink)
                        .lineLimit(1)
                    Circle()
                        .fill(app.connection == .connected ? MC.online : .orange)
                        .frame(width: 7, height: 7)
                        .accessibilityLabel(app.connection.label)
                }
                Text(app.currentUser?.email ?? "")
                    .font(.system(size: 12))
                    .foregroundStyle(MC.muted)
                    .lineLimit(1)
                Text(statusText.isEmpty ? "No status set" : "\(statusEmoji) \(statusText)")
                    .font(.system(size: 13))
                    .foregroundStyle(statusText.isEmpty ? MC.faint : MC.inkSoft)
                    .lineLimit(1)
                    .accessibilityIdentifier("account.statusLabel")
            }
        }
        .padding(.vertical, 4)
    }

    private func setStatus(_ emoji: String, _ text: String, _ suppresses: Bool) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await app.engine.setStatus(emoji: emoji, text: text, suppressAlerts: suppresses)
            } catch {
                app.showError(error.localizedDescription)
            }
        }
    }
}

// MARK: - My profile (view + edit)

/// Pushed from the account sheet: avatar, display name and timezone, saved
/// through the same PATCH /v1/me the other clients use.
struct MyProfileView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var displayName = ""
    @State private var timezone = TimeZone.current.identifier
    @State private var busy = false
    @State private var avatarBusy = false
    @State private var error: String?
    @State private var photoItem: PhotosPickerItem?

    private static let timezones = TimeZone.knownTimeZoneIdentifiers.sorted()

    private var trimmedName: String { displayName.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        // Read on the main actor here: PhotosPicker's label closure is Sendable,
        // so touching @State from inside it is a concurrency violation (a
        // warning today, an error under the Swift 6 language mode).
        let uploading = avatarBusy
        Form {
            Section {
                HStack(spacing: 14) {
                    AvatarChip(
                        userId: app.currentUser?.id ?? "",
                        name: app.currentUser?.displayName ?? "?",
                        avatarPath: app.myAvatarPath,
                        size: 64,
                        radius: 18
                    )
                    // Re-render when the avatar key changes after an upload.
                    .id(app.currentUser?.avatarUrl ?? "")
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Text(uploading ? "Uploading…" : "Change Avatar…")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(MC.accent)
                    }
                    .disabled(avatarBusy)
                    .accessibilityIdentifier("profile.changeAvatar")
                }
                .padding(.vertical, 4)
            }

            Section("Display name") {
                TextField("Display name", text: $displayName)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("profile.displayName")
            }

            Section("Timezone") {
                Picker("Timezone", selection: $timezone) {
                    ForEach(Self.timezones, id: \.self) { tz in Text(tz).tag(tz) }
                }
                .pickerStyle(.navigationLink)
                .accessibilityIdentifier("profile.timezone")
            }

            Section("Email") {
                Text(app.currentUser?.email ?? "")
                    .foregroundStyle(MC.inkSoft)
            }

            if let error {
                Section { Text(error).font(.callout).foregroundStyle(.red) }
            }
        }
        .navigationTitle("My Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save") { save() }
                    .disabled(busy || trimmedName.isEmpty)
                    .accessibilityIdentifier("profile.save")
            }
        }
        .onAppear {
            displayName = app.currentUser?.displayName ?? ""
            timezone = app.currentUser?.timezone ?? TimeZone.current.identifier
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            uploadAvatar(item)
        }
    }

    private func save() {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await app.engine.updateProfile(displayName: trimmedName, timezone: timezone)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    /// Photo-library pick → temp file → the engine's multipart avatar upload.
    /// Web-friendly formats keep their original bytes; anything else (HEIC)
    /// is re-encoded to JPEG, same rule the composer's photo path uses.
    private func uploadAvatar(_ item: PhotosPickerItem) {
        avatarBusy = true
        error = nil
        Task {
            defer {
                avatarBusy = false
                photoItem = nil
            }
            guard let data = try? await item.loadTransferable(type: Data.self) else {
                error = "Couldn't load the selected photo"
                return
            }
            let type = item.supportedContentTypes.first
            let epochMs = Int(Date().timeIntervalSince1970 * 1000)
            let url: URL
            if let type, [UTType.png, .jpeg, .gif, .webP].contains(type) {
                let ext = type.preferredFilenameExtension ?? "png"
                url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("avatar-\(epochMs).\(ext)")
                try? data.write(to: url)
            } else if let image = UIImage(data: data),
                      let jpeg = image.jpegData(compressionQuality: 0.9) {
                url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("avatar-\(epochMs).jpg")
                try? jpeg.write(to: url)
            } else {
                error = "Unsupported image format"
                return
            }
            defer { try? FileManager.default.removeItem(at: url) }
            do {
                try await app.engine.uploadAvatar(fileURL: url)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
