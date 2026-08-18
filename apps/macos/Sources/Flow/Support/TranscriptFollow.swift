import CoreGraphics

/// The "should the transcript re-stick to its newest message?" decision, pulled
/// out of the iOS `MessageListView` so it can be tested without a simulator.
/// It lives here because `Support/` is the one source tree both apps compile —
/// macOS keeps its own `MessageListView.followDecision`, which answers a
/// different question (it also owns pin/unpin).
///
/// iOS's list has two things macOS's doesn't: a `hasDragged` flag, and a
/// deliberately narrowed scroll anchor. On iOS 18+ `BottomAnchor` scopes
/// `.defaultScrollAnchor(.bottom)` to `.initialOffset` + `.alignment`, dropping
/// the size-change role because the framework's version of it yanked any short
/// back-pull to the bottom on release (#159). Everything that role used to do
/// is now this decision's job.
enum TranscriptFollow {
    /// Re-assert the bottom after a content-frame change?
    ///
    /// - `old` / `new`: the content's frame in the scroll view's coordinate
    ///   space, before and after. `maxY` is the content's bottom edge relative
    ///   to the top of the viewport, so `maxY - viewportHeight` is how far the
    ///   newest message sits below the visible area — negative when the
    ///   viewport is parked past the end of the content.
    static func shouldRestick(
        pinned: Bool,
        hasDragged: Bool,
        isDragging: Bool,
        hasFocusTarget: Bool,
        old: CGRect,
        new: CGRect,
        viewportHeight: CGFloat,
        bottomSlack: CGFloat
    ) -> Bool {
        // A jump-to-message owns the scroll position, a finger on the glass
        // owns it outright, and a reader who left the end stays where they are.
        guard !hasFocusTarget, pinned, !isDragging else { return false }
        // Was the reader at the end when the layout moved? Deliberately reads
        // the OLD frame: a tall new row pushes the new frame's bottom far past
        // the slack even for someone sitting right at the end, and the glue
        // exists for exactly them.
        guard old.maxY - viewportHeight <= bottomSlack else { return false }

        // Before the first drag the list owns its position outright, so any
        // resize re-sticks — including a *shrink* (#280). That is the blank
        // transcript: `.initialOffset` resolves against the `LazyVStack`'s
        // estimated content height, and when the real rows come in shorter the
        // estimate's "bottom" is an offset past where the content actually
        // ends. Nothing then moved the viewport back, because the growth-only
        // rule below never fired.
        if !hasDragged { return abs(new.height - old.height) > 1 }

        // Once the reader has touched the list, only growth may move it. A
        // LazyVStack shrinks mid-scroll too, as estimates resolve, and
        // re-sticking on that is the short-pull bounce all over again (#159).
        return new.height > old.height + 1
    }
}
