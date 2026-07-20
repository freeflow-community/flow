import SwiftUI

/// Minimal message composer: expanding text field + send. Emoji/mention sugar
/// and file attachments are handled server-side via SyncEngine.sendMessage;
/// richer input (autocomplete, attachments) is a later iOS increment.
struct ComposerView: View {
    let channelId: String
    var threadRootId: String? = nil
    var placeholder: String = "Message"
    @EnvironmentObject var app: AppState
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(1...6)
                .focused($focused)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 18).fill(MC.base))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(MC.hairline2))
                .onSubmit(send)

            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(canSend ? MC.send : MC.faint)
            }
            .disabled(!canSend)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(MC.base)
    }

    private var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() {
        let body = text
        guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        text = ""
        Task { await app.engine.sendMessage(channelId: channelId, body: body, threadRootId: threadRootId) }
    }
}
