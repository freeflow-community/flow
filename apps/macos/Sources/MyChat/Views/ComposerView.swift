import SwiftUI

struct ComposerView: View {
    let channelId: String
    let threadRootId: String?
    let placeholder: String

    @EnvironmentObject private var app: AppState
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(placeholder, text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...8)
                .focused($focused)
                .onSubmit(send)
                .onChange(of: text) { _, newValue in
                    guard !newValue.isEmpty else { return }
                    Task { await app.engine.typing(channelId: channelId) }
                }
                .accessibilityIdentifier(threadRootId == nil ? "composer.input" : "thread.composer.input")

            Button(action: send) {
                Image(systemName: "paperplane.fill")
            }
            .buttonStyle(.borderless)
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .help("Send message")
            .accessibilityIdentifier(threadRootId == nil ? "composer.send" : "thread.composer.send")
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(.quaternary, lineWidth: 1)
        )
        .padding([.horizontal, .bottom], 12)
        .padding(.top, 4)
        .onAppear { focused = true }
    }

    private func send() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        text = ""
        Task {
            await app.engine.sendMessage(
                channelId: channelId,
                body: body,
                threadRootId: threadRootId
            )
        }
    }
}
