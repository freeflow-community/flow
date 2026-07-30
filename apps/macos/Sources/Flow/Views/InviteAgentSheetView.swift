import AppKit
import SwiftUI

/// "Invite your Agent" (phase 15, web parity): mints a one-time invite code for
/// this workspace and shows the exact command to run. The agent redeems the code
/// and joins immediately — no sponsor approval, no matching popup. The code
/// carries the sponsor (you) + workspace; a fresh code is minted each time the
/// sheet opens, and each code is single-use.
struct InviteAgentSheetView: View {
    let workspaceId: String
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var command: String?
    @State private var failed = false
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Invite your Agent").flowFont(.headline)
            Text("Invite your coding agent (Claude, Codex, OpenCode, …) to join the workspace!")
                .flowFont(.callout)
                .foregroundStyle(.secondary)
                .padding(.top, 4)

            Text("Wherever you run your coding agent, just run:")
                .flowFont(.callout)
                .foregroundStyle(.secondary)
                .padding(.top, 16)

            HStack(alignment: .top, spacing: 8) {
                Text(commandLabel)
                    .flowFont(.callout, design: .monospaced)
                    .textSelection(.enabled)
                    .foregroundStyle(command == nil ? .secondary : .primary)
                    .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 6).fill(.quaternary.opacity(0.5)))
                    .accessibilityIdentifier("inviteAgent.command")

                Button {
                    guard let command else { return }
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(command, forType: .string)
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .disabled(command == nil)
                .accessibilityIdentifier("inviteAgent.copy")
            }
            .padding(.top, 6)

            (
                Text("This is a ")
                    + Text("one-time invite code").fontWeight(.semibold).foregroundColor(.primary)
                    + Text(
                        " tied to you as the sponsor. Your agent picks its name and handle, then joins "
                            + "right away — no approval needed. Pick its avatar any time from the members list."
                    )
            )
            .flowFont(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 14)

            Text("Collaborate with agents on tasks and code, share files and artifacts, and bring them onto the team.")
                .flowFont(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)

            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.top, 18)
        }
        .padding(20)
        .frame(width: 460)
        // Mint a code as soon as the sheet opens — one per open, like web.
        .task {
            do {
                command = try await app.engine.createAgentInvite(workspaceId: workspaceId).command
            } catch {
                failed = true
            }
        }
    }

    private var commandLabel: String {
        if let command { return command }
        return failed ? "Could not generate an invite code — close and try again." : "Generating your invite code…"
    }
}
