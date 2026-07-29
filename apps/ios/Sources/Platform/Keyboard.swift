import SwiftUI
import UIKit

/// Dismissing the software keyboard from *outside* the view that owns focus.
///
/// Composer focus lives in a `@FocusState private var` inside `ComposerView`,
/// so a parent (the drawer, the message list) has no handle on it. The
/// app-wide resign-first-responder is the escape hatch — the keyboard belongs
/// to the screen, not to the composer, so anything that takes over the screen
/// is entitled to put it away (#69).
@MainActor
func dismissKeyboard() {
    UIApplication.shared.sendAction(
        #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}

extension View {
    /// Tapping anywhere in this view dismisses the keyboard. `simultaneousGesture`
    /// rather than `onTapGesture` so the content keeps its own taps — opening a
    /// thread, following a link, long-pressing for the reaction picker.
    func dismissesKeyboardOnTap() -> some View {
        simultaneousGesture(TapGesture().onEnded { dismissKeyboard() })
    }

    /// The chat area's keyboard policy (#139): *any* interaction with the
    /// transcript puts the keyboard away — a tap, or the first moment of a
    /// scroll.
    ///
    /// `.immediately` rather than `.interactively` (#69) because reading
    /// back-scroll is the common case and the keyboard covers half the phone
    /// while you do it; interactive dismissal only completed when the drag
    /// happened to pull down across the keyboard itself, so scrolling *up*
    /// through history left it standing.
    func dismissesKeyboardOnChatInteraction() -> some View {
        scrollDismissesKeyboard(.immediately)
            .dismissesKeyboardOnTap()
    }
}
