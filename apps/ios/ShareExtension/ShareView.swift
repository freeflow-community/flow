import SwiftUI

/// The sheet itself. Deliberately one screen: pick a channel, add a caption,
/// Send. The extension dies when the sheet dismisses, so there is nowhere to
/// navigate to and back from.
struct ShareView: View {
    @ObservedObject var store: ShareStore
    let onFinish: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                switch store.phase {
                case .loading:
                    ProgressView("Loading channels…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .ready, .sending:
                    form
                case .sent:
                    status(icon: "checkmark.circle.fill", tint: .green, text: "Sent to Flow")
                case .failed(let message):
                    status(icon: "exclamationmark.triangle.fill", tint: .orange, text: message)
                }
            }
            .navigationTitle("Share to Flow")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if store.phase == .sending {
                        ProgressView()
                    } else {
                        Button("Send") {
                            Task {
                                await store.send()
                                if store.phase == .sent { onFinish() }
                            }
                        }
                        .disabled(!store.canSend)
                        .accessibilityIdentifier("share.send")
                    }
                }
            }
        }
    }

    private var form: some View {
        Form {
            if store.workspaces.count > 1 {
                Section("Workspace") {
                    Picker("Workspace", selection: workspaceBinding) {
                        ForEach(store.workspaces) { workspace in
                            Text(workspace.name).tag(workspace.id)
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
            Section("Channel") {
                // A navigation-link picker, not an inline list: a real account
                // has dozens of channels, and inline pushes the caption and
                // everything under it off the bottom of the sheet.
                Picker("Channel", selection: $store.channelId) {
                    ForEach(store.visibleChannels) { channel in
                        Text(store.title(for: channel)).tag(Optional(channel.id))
                    }
                }
                .pickerStyle(.navigationLink)
                .accessibilityIdentifier("share.channel")
            }
            Section(captionSectionTitle) {
                TextField(captionPlaceholder, text: $store.caption, axis: .vertical)
                    .lineLimit(1...4)
                    .accessibilityIdentifier("share.caption")
            }
        }
        .disabled(store.phase == .sending)
    }

    /// A shared link arrives *as* the message body, so calling that field
    /// "Caption" would be a lie.
    private var captionSectionTitle: String {
        if case .image = store.payload { return "Caption" }
        return "Message"
    }

    private var captionPlaceholder: String {
        if case .image = store.payload { return "Add a caption (optional)" }
        return "Message"
    }

    private var workspaceBinding: Binding<String> {
        Binding(
            get: { store.workspaceId ?? "" },
            set: { id in Task { await store.selectWorkspace(id) } }
        )
    }

    private func status(icon: String, tint: Color, text: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon).font(.largeTitle).foregroundStyle(tint)
            Text(text)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("share.status")
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
