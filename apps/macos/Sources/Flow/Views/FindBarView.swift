import AppKit
import SwiftUI

/// Inline chat find (#518): the per-channel find state, and the bar that
/// renders it.
///
/// The state is an object rather than `@State` so the Edit ▸ Find menu item can
/// reach it: `ChannelView` publishes it as a focused scene value, and the
/// command in `FlowApp` picks up whichever window is frontmost.
@MainActor
final class ChatFindModel: ObservableObject {
    @Published var isOpen = false
    @Published var query = ""
    /// Index into the channel's ordered match list; -1 is "nothing selected",
    /// which is what "0/0" renders from.
    @Published var index = -1
    /// Bumped by every ⌘F. The bar watches it so a second press puts the caret
    /// back in the box and selects what is there, ready to be typed over.
    @Published private(set) var focusTick = 0

    /// ⌘F: open the bar, or take focus back if it is already open.
    func openOrRefocus() {
        isOpen = true
        focusTick += 1
    }

    /// Esc / the ✕: hide the bar, drop the query, forget the cursor. The
    /// transcript stays exactly where it is.
    func close() {
        isOpen = false
        query = ""
        index = -1
    }
}

/// Lets the Edit menu talk to the frontmost window's find bar.
struct ChatFindKey: FocusedValueKey {
    typealias Value = ChatFindModel
}

extension FocusedValues {
    var chatFind: ChatFindModel? {
        get { self[ChatFindKey.self] }
        set { self[ChatFindKey.self] = newValue }
    }
}

/// Edit ▸ Find in Conversation. A shortcut with no menu item is
/// undiscoverable on macOS (the reasoning `TextZoomCommands` spells out), and
/// owning the ⌘F menu key equivalent is also what keeps AppKit's own find bar
/// off the composer's text view.
struct ChatFindCommands: View {
    @FocusedValue(\.chatFind) private var find

    var body: some View {
        Button("Find in Conversation…") { find?.openOrRefocus() }
            .keyboardShortcut("f", modifiers: .command)
            .disabled(find == nil)
    }
}

/// The bar itself: query box, "n of m" counter, prev/next, and a ✕.
struct FindBarView: View {
    @ObservedObject var find: ChatFindModel
    let total: Int
    /// Called with +1 / -1 — the channel owns the cursor, since it owns the
    /// match list the cursor indexes into.
    let onStep: (Int) -> Void

    @FocusState private var focused: Bool

    private var noMatches: Bool { !find.query.isEmpty && total == 0 }

    var body: some View {
        HStack(spacing: 8) {
            TextField("Find in loaded messages", text: $find.query)
                .textFieldStyle(.plain)
                .flowFont(.callout)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 7).fill(.white))
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .strokeBorder(noMatches ? MC.unread : MC.hairline, lineWidth: 1)
                )
                .focused($focused)
                .onSubmit { onStep(1) }
                // Shift-Return steps backwards. `onSubmit` can't see modifiers,
                // so the shifted case is caught before it and consumed.
                .onKeyPress(.return, phases: .down) { press in
                    guard press.modifiers.contains(.shift) else { return .ignored }
                    onStep(-1)
                    return .handled
                }
                .accessibilityIdentifier("find.query")

            Text(ChatSearch.label(current: find.index, total: total))
                .flowFont(size: 11, weight: noMatches ? .bold : nil)
                .foregroundStyle(noMatches ? MC.unread : MC.muted)
                .monospacedDigit()
                .accessibilityIdentifier("find.count")

            stepButton("chevron.up", label: "Previous match", direction: -1)
            stepButton("chevron.down", label: "Next match", direction: 1)

            Button { find.close() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(MC.muted)
            .pointingHandCursor()
            .help("Close find (esc)")
            .accessibilityIdentifier("find.close")
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 6)
        .background(MC.base)
        .overlay(alignment: .bottom) { Divider() }
        // Esc closes from anywhere in the pane, not only from inside the box.
        .onExitCommand { find.close() }
        .onAppear { takeFocus() }
        .onChange(of: find.focusTick) { _, _ in takeFocus() }
    }

    private func stepButton(_ symbol: String, label: String, direction: Int) -> some View {
        Button { onStep(direction) } label: {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(total == 0 ? MC.faint : MC.muted)
        .disabled(total == 0)
        .pointingHandCursor()
        .help(label)
        .accessibilityIdentifier(direction > 0 ? "find.next" : "find.previous")
    }

    /// Focus the box and select what is in it, so a second ⌘F is "search for
    /// something else" rather than a no-op. SwiftUI has no select-all, so the
    /// field editor is asked directly once focus has actually landed.
    private func takeFocus() {
        focused = true
        DispatchQueue.main.async {
            (NSApp.keyWindow?.firstResponder as? NSTextView)?.selectAll(nil)
        }
    }
}
