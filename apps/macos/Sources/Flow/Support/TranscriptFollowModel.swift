import CoreGraphics

/// The single owner of a transcript's follow/scroll decisions, shared by the
/// macOS and iOS message lists (`Support/` is the one source tree both apps
/// compile).
///
/// Before this, each list steered its scroll position from several
/// independent drivers — a follow on the newest message id, a "glue" on
/// content-frame changes, a re-stick on viewport changes, and (iOS) a
/// distance-based pin heuristic — each reading `@State` measurements written
/// by *different* GeometryReaders at *different* times. Every reported
/// transcript bug traced back to two of them disagreeing mid-transition:
/// the keyboard raising flipped the pin off and raised the jump pill (#159's
/// successor), a composer resize scrolled the list into empty space, a late
/// row height left a new message half out of view.
///
/// The model replaces them with one state machine:
/// - Views feed it events (geometry changes, drags, new messages, keyboard
///   transitions) and execute the single command it returns. Nothing else
///   may call `scrollTo` toward the bottom.
/// - Pin state only changes on evidence of *reader intent* (a scroll), never
///   on content growth or viewport resizes.
/// - While a bracketed transition is active (the iOS keyboard animating),
///   all decisions freeze; one unanimated re-stick fires at the end.
///
/// Two follow styles cover the deliberate platform divergence (#159): macOS
/// unpins on any upward scroll (`.topEdge` — there is no touch, so wheel and
/// trackpad deltas are the only signal); iOS unpins only on a real drag past
/// a threshold (`.dragDistance`).
struct TranscriptFollowModel: Equatable {
    enum Style: Equatable {
        /// macOS: the content's top edge moving down (an upward scroll)
        /// unpins; nearing the bottom re-pins.
        case topEdge
        /// iOS: only a finger-drag past `minBackScroll` unpins; back within
        /// `bottomSlack` re-pins.
        case dragDistance
    }

    /// What the view must do after an event. `stick` targets the newest
    /// message's bottom edge — the same target as `defaultScrollAnchor`, so
    /// the two can never disagree.
    enum Command: Equatable {
        case none
        case stick(animated: Bool)
    }

    let style: Style
    /// Within this much of the end still counts as "at the bottom".
    var bottomSlack: CGFloat = 120
    /// Within this much of the end, any scroll re-pins (`.topEdge` only).
    var repinSlack: CGFloat = 40
    /// Back-scroll shorter than this is a nudge, not a decision to leave
    /// (`.dragDistance` only).
    var minBackScroll: CGFloat = 200

    /// The follow is glued to the newest message.
    private(set) var pinned = true
    /// The reader has dragged this list at least once. Before that the list
    /// owns its own position and corrects itself in either direction (#280).
    private(set) var hasDragged = false
    private(set) var isDragging = false
    /// Nesting depth of bracketed transitions (keyboard show/hide).
    private(set) var transitions = 0
    /// A jump-to-message target owns the scroll position; every command is
    /// suppressed until the view clears it.
    var focusActive = false

    /// Last known content frame in the scroll view's coordinate space.
    private(set) var contentFrame = CGRect.zero
    /// Last known viewport height.
    private(set) var viewportHeight: CGFloat = 0

    var inTransition: Bool { transitions > 0 }
    /// How far the newest message sits below the viewport.
    var distanceFromBottom: CGFloat { max(0, contentFrame.maxY - viewportHeight) }
    /// Purely geometric "near the end".
    var atBottom: Bool { contentFrame.maxY - viewportHeight <= bottomSlack }
    /// Raw jump-pill signal. The views debounce it (~150ms of sustained truth)
    /// so a transient measurement can never flicker the pill up.
    var showJump: Bool { !pinned && !atBottom }

    // MARK: - Geometry events

    /// The content frame moved or resized (in the scroll view's space).
    mutating func contentChanged(to new: CGRect) -> Command {
        let old = contentFrame
        contentFrame = new
        guard !focusActive, !inTransition else { return .none }
        switch style {
        case .topEdge:
            // Order is load-bearing (see the tests): the pin check runs first
            // so an elastic bounce-back at the bottom can't read as an upward
            // scroll, and our own glue animating down stays quiet.
            if new.maxY - viewportHeight <= repinSlack {
                pinned = true
                return .none
            }
            if new.minY > old.minY + 1 {
                pinned = false
                return .none
            }
            if pinned, new.height > old.height + 1 {
                return .stick(animated: true)
            }
            return .none

        case .dragDistance:
            var command = Command.none
            // Re-stick after a resize, for a reader who was at the end when it
            // happened (the OLD frame — a tall new row pushes the new bottom
            // past the slack for exactly the reader the glue exists for).
            // Before the first drag any resize corrects, including a shrink
            // (#280); after it, only growth may move the list (#159).
            if pinned, !isDragging, old.maxY - viewportHeight <= bottomSlack,
               hasDragged ? new.height > old.height + 1 : abs(new.height - old.height) > 1 {
                command = .stick(animated: false)
            }
            // Pin state follows the reader, and only the reader: a frame where
            // the height changed is content settling, not a scroll, and the
            // viewport never enters into it — which is what kept the keyboard
            // from unpinning the follow.
            if hasDragged, abs(new.height - old.height) <= 1 {
                if distanceFromBottom > minBackScroll {
                    pinned = false
                } else if distanceFromBottom <= bottomSlack {
                    pinned = true
                }
            }
            return command
        }
    }

    /// The viewport was resized (keyboard, composer growth, window resize).
    /// Never a pin decision — a viewport change is not a scroll — but a
    /// pinned reader is carried along to the newest message.
    mutating func viewportChanged(to newHeight: CGFloat) -> Command {
        viewportHeight = newHeight
        guard !focusActive, !inTransition, pinned, !isDragging else { return .none }
        return .stick(animated: false)
    }

    // MARK: - Reader intent

    mutating func dragBegan() {
        isDragging = true
        hasDragged = true
    }

    mutating func dragEnded() {
        isDragging = false
    }

    /// The jump pill was tapped.
    mutating func jumpTapped() -> Command {
        pinned = true
        return .stick(animated: true)
    }

    // MARK: - Content events

    /// The newest message changed. My own message always re-pins — I just
    /// pressed send, so I mean to see it land (#111 kept everyone else's
    /// messages from dragging a back-scrolled reader down; the pill offers
    /// the trip instead).
    mutating func lastMessageChanged(isOwn: Bool) -> Command {
        guard !focusActive else { return .none }
        if isOwn { pinned = true }
        guard pinned else { return .none }
        return .stick(animated: true)
    }

    /// The settle pass (#280): while the reader has never dragged, keep
    /// re-asserting the end for a beat after content appears, because a
    /// LazyVStack's estimates can be wrong without ever changing the frame.
    func settleCommand() -> Command {
        guard !hasDragged, pinned, !focusActive, !inTransition else { return .none }
        return .stick(animated: false)
    }

    // MARK: - Transitions (keyboard show/hide)

    /// A viewport transition is starting: freeze every decision until it ends.
    /// Mid-animation geometry is a state that never existed on screen, and
    /// deciding from it is what flickered the pill up when the keyboard rose.
    mutating func transitionBegan() {
        transitions += 1
    }

    /// The transition finished: one unanimated re-stick for a pinned reader.
    mutating func transitionEnded() -> Command {
        transitions = max(0, transitions - 1)
        guard transitions == 0, pinned, !focusActive, !isDragging else { return .none }
        return .stick(animated: false)
    }

    // MARK: - External position owners

    /// A jump-to-message is taking the scroll position: unpin so no glue or
    /// follow fights the centering scroll.
    mutating func focusEngaged() {
        focusActive = true
        pinned = false
    }

    /// An external owner parked the reader somewhere on purpose: a channel
    /// entry landing at the bottom (pinned), or "Load earlier messages"
    /// stepping into history (unpinned — reading history is a decision to
    /// leave the end).
    mutating func positionRestored(atBottom: Bool) {
        pinned = atBottom
    }
}
