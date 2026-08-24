import CoreGraphics
import XCTest

@testable import Flow

/// The single scroll owner for both transcripts (`TranscriptFollowModel`).
/// This suite absorbs the two it replaces — `MessageFollowTests` (the macOS
/// `followDecision` rules, now the `.topEdge` style) and
/// `TranscriptFollowTests` (the iOS re-stick gates from #159/#280, now the
/// `.dragDistance` style) — every case ported with its original expectation,
/// plus the new machinery: viewport events, transition brackets, own-message
/// re-pin, and the jump/settle/focus paths.
final class TranscriptFollowModelTests: XCTestCase {
    /// Content frame in the scroll view's space: `top` is -offset, so maxY is
    /// the content's bottom edge measured from the top of the viewport.
    private func frame(top: CGFloat, height: CGFloat) -> CGRect {
        CGRect(x: 0, y: top, width: 400, height: height)
    }

    /// A model with its geometry seeded (events return commands from the
    /// *stored* previous frame, exactly like the views feed it).
    private func model(
        _ style: TranscriptFollowModel.Style,
        viewport: CGFloat,
        content: CGRect
    ) -> TranscriptFollowModel {
        var m = TranscriptFollowModel(style: style)
        _ = m.viewportChanged(to: viewport)
        _ = m.contentChanged(to: content)
        return m
    }

    // MARK: - .topEdge (macOS) — ported from MessageFollowTests

    /// The regression itself: a tall message grows the content past the slack
    /// while we're pinned at the bottom → glue back down, don't unpin.
    func testTallMessageWhilePinnedGlues() {
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        let cmd = m.contentChanged(to: frame(top: -1400, height: 2400))
        XCTAssertEqual(cmd, .stick(animated: true))
        XCTAssertTrue(m.pinned)
    }

    /// Same growth while the reader is up in history → nothing moves.
    func testGrowthWhileUnpinnedDoesNothing() {
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        _ = m.contentChanged(to: frame(top: -1100, height: 2000)) // scroll up: unpin
        XCTAssertFalse(m.pinned)
        let cmd = m.contentChanged(to: frame(top: -1100, height: 2400))
        XCTAssertEqual(cmd, .none)
        XCTAssertFalse(m.pinned)
    }

    /// Scrolling up (content's top edge moves down) is the one unpin signal.
    func testUpwardScrollUnpins() {
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        XCTAssertEqual(m.contentChanged(to: frame(top: -1100, height: 2000)), .none)
        XCTAssertFalse(m.pinned)
    }

    /// Scrolling back to within the re-pin slack re-engages the follow.
    func testScrollingToBottomRepins() {
        var m = model(.topEdge, viewport: 600, content: frame(top: -1100, height: 2000))
        _ = m.contentChanged(to: frame(top: -1200, height: 2000)) // still out
        XCTAssertEqual(m.contentChanged(to: frame(top: -1380, height: 2000)), .none)
        XCTAssertTrue(m.pinned) // maxY 620 → within 40pt
    }

    /// Elastic bounce-back at the bottom moves the top edge down but lands
    /// within the slack — the pin check runs first, so it must not unpin.
    func testBounceBackAtBottomStaysPinned() {
        var m = model(.topEdge, viewport: 600, content: frame(top: -1420, height: 2000))
        _ = m.contentChanged(to: frame(top: -1400, height: 2000))
        XCTAssertTrue(m.pinned)
    }

    /// Our own glue scroll animating down (top edge moves up, no growth)
    /// must not re-trigger another glue every frame.
    func testDownwardScrollFramesAreQuiet() {
        var m = model(.topEdge, viewport: 600, content: frame(top: -1100, height: 2400))
        XCTAssertEqual(m.contentChanged(to: frame(top: -1300, height: 2400)), .none)
    }

    // MARK: - .dragDistance (iOS) — ported from TranscriptFollowTests

    private func dragModel(
        viewport: CGFloat = 800, content: CGRect, dragged: Bool = false
    ) -> TranscriptFollowModel {
        var m = model(.dragDistance, viewport: viewport, content: content)
        if dragged {
            m.dragBegan()
            m.dragEnded()
        }
        return m
    }

    /// #280: the list opens parked past the end of the content, then the
    /// content shrinks as estimates resolve. Nothing has been dragged, so
    /// this must pull the viewport back to the newest message.
    func testShrinkBeforeFirstDragResticks() {
        var m = dragModel(content: frame(top: -3000, height: 3400)) // maxY 400: blank below
        XCTAssertEqual(
            m.contentChanged(to: frame(top: -3000, height: 3100)), .stick(animated: false))
    }

    /// Same shrink once the reader has dragged: they own the position (#159).
    func testShrinkAfterFirstDragDoesNothing() {
        var m = dragModel(content: frame(top: -3000, height: 3400), dragged: true)
        XCTAssertEqual(m.contentChanged(to: frame(top: -3000, height: 3100)), .none)
    }

    /// A viewport parked past the end still counts as "at the bottom".
    func testParkedPastTheEndCountsAsAtTheBottom() {
        var m = dragModel(content: frame(top: -3600, height: 3400)) // maxY -200
        XCTAssertEqual(
            m.contentChanged(to: frame(top: -3600, height: 3200)), .stick(animated: false))
    }

    /// Layout noise below the 1pt threshold isn't a resize.
    func testSubPointResizeIsIgnored() {
        var m = dragModel(content: frame(top: -3000, height: 3400))
        XCTAssertEqual(m.contentChanged(to: frame(top: -3000, height: 3400.5)), .none)
    }

    /// A pure scroll — the offset moved, the content didn't resize — never
    /// re-sticks, even before the first drag.
    func testOffsetChangeWithoutResizeDoesNothing() {
        var m = dragModel(content: frame(top: -3000, height: 3400))
        XCTAssertEqual(m.contentChanged(to: frame(top: -2950, height: 3400)), .none)
    }

    /// Growth while pinned at the end re-sticks, dragged or not (#191).
    func testGrowthWhilePinnedAtTheEndGlues() {
        var fresh = dragModel(content: frame(top: -2600, height: 3400)) // maxY 800: at bottom
        XCTAssertEqual(
            fresh.contentChanged(to: frame(top: -2600, height: 3900)), .stick(animated: false))
        var dragged = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        XCTAssertEqual(
            dragged.contentChanged(to: frame(top: -2600, height: 3900)), .stick(animated: false))
    }

    /// Read-back history: the reader is well above the end, so growth must
    /// not drag them down — and must not change the pin either way.
    func testGrowthWhileBackScrolledDoesNothing() {
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        _ = m.contentChanged(to: frame(top: -400, height: 3400)) // scroll far up
        XCTAssertFalse(m.pinned)
        XCTAssertEqual(m.contentChanged(to: frame(top: -400, height: 3900)), .none)
        XCTAssertFalse(m.pinned)
    }

    /// A finger on the glass owns the list outright, first drag or not.
    func testMidDragNeverResticks() {
        var m = dragModel(content: frame(top: -3000, height: 3400))
        m.dragBegan()
        XCTAssertEqual(m.contentChanged(to: frame(top: -3000, height: 3100)), .none)
    }

    /// A pending jump-to-message owns the scroll position until it lands.
    func testFocusTargetSuppressesResticks() {
        var m = dragModel(content: frame(top: -3000, height: 3400))
        m.focusActive = true
        XCTAssertEqual(m.contentChanged(to: frame(top: -3000, height: 3100)), .none)
    }

    /// Just inside the slack still counts as at the end; just outside doesn't.
    func testSlackBoundary() {
        var inside = dragModel(content: frame(top: -2600, height: 3520), dragged: true) // maxY 920 == 800+120
        XCTAssertEqual(
            inside.contentChanged(to: frame(top: -2600, height: 3900)), .stick(animated: false))
        var outside = dragModel(content: frame(top: -2600, height: 3521), dragged: true)
        XCTAssertEqual(outside.contentChanged(to: frame(top: -2600, height: 3900)), .none)
    }

    /// The drag thresholds: a short pull is a nudge, a real pull unpins, and
    /// coming back within the slack re-pins.
    func testDragDistanceThresholds() {
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        _ = m.contentChanged(to: frame(top: -2450, height: 3400)) // 150pt: under 200
        XCTAssertTrue(m.pinned)
        _ = m.contentChanged(to: frame(top: -2300, height: 3400)) // 300pt: past 200
        XCTAssertFalse(m.pinned)
        _ = m.contentChanged(to: frame(top: -2550, height: 3400)) // 50pt: within 120
        XCTAssertTrue(m.pinned)
    }

    // MARK: - Viewport events (the keyboard / composer resize)

    /// A pinned reader is carried along when the viewport resizes; the pin
    /// itself never changes — a viewport change is not a scroll. This is the
    /// "keyboard raises the jump pill" bug: the distance spike must neither
    /// unpin nor show the pill.
    func testViewportShrinkWhilePinnedSticksAndStaysPinned() {
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        XCTAssertEqual(m.viewportChanged(to: 500), .stick(animated: false))
        XCTAssertTrue(m.pinned)
        XCTAssertFalse(m.showJump)
    }

    /// An unpinned reader keeps their place through a viewport resize.
    func testViewportChangeWhileUnpinnedDoesNothing() {
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        _ = m.contentChanged(to: frame(top: -2300, height: 3400)) // unpin
        XCTAssertEqual(m.viewportChanged(to: 500), .none)
        XCTAssertFalse(m.pinned)
    }

    // MARK: - Transition brackets

    /// Between transitionBegan and the last transitionEnded, every decision
    /// freezes: mid-animation geometry is a state that never held still.
    func testTransitionFreezesDecisions() {
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        m.transitionBegan()
        XCTAssertEqual(m.viewportChanged(to: 500), .none)
        // A huge apparent back-scroll mid-animation must not unpin.
        XCTAssertEqual(m.contentChanged(to: frame(top: -2000, height: 3400)), .none)
        XCTAssertTrue(m.pinned)
        XCTAssertEqual(m.transitionEnded(), .stick(animated: false))
    }

    /// The end-of-transition stick only serves a pinned reader.
    func testTransitionEndWhileUnpinnedDoesNothing() {
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        _ = m.contentChanged(to: frame(top: -2300, height: 3400)) // unpin
        m.transitionBegan()
        XCTAssertEqual(m.transitionEnded(), .none)
    }

    /// Nested brackets (keyboard hide starting while show settles) only
    /// re-stick once the last one ends — and only if the geometry actually
    /// needs it (the viewport moved under a pinned reader).
    func testNestedTransitions() {
        var m = dragModel(content: frame(top: -2600, height: 3400))
        m.transitionBegan()
        m.transitionBegan()
        _ = m.viewportChanged(to: 500) // mid-animation keyboard frame
        XCTAssertEqual(m.transitionEnded(), .none)
        XCTAssertEqual(m.transitionEnded(), .stick(animated: false))
    }

    /// An unbalanced end (a Did without its Will) must not wedge the count —
    /// and with the geometry already aligned it must not scroll either.
    func testUnbalancedTransitionEndIsHarmless() {
        var m = dragModel(content: frame(top: -2600, height: 3400))
        XCTAssertEqual(m.transitionEnded(), .none) // maxY 800 == viewport: aligned
        XCTAssertFalse(m.inTransition)
    }

    // MARK: - Messages, jump, settle, focus

    /// My own message always re-pins — I just pressed send.
    func testOwnMessageRepinsFromBackScroll() {
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        _ = m.contentChanged(to: frame(top: -2300, height: 3400)) // unpin
        XCTAssertEqual(m.lastMessageChanged(isOwn: true), .stick(animated: true))
        XCTAssertTrue(m.pinned)
    }

    /// Someone else's message leaves a back-scrolled reader in place (#111).
    func testOthersMessageWhileUnpinnedDoesNothing() {
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        _ = m.contentChanged(to: frame(top: -2300, height: 3400))
        XCTAssertEqual(m.lastMessageChanged(isOwn: false), .none)
        XCTAssertFalse(m.pinned)
    }

    func testMessageWhilePinnedFollows() {
        var m = dragModel(content: frame(top: -2600, height: 3400))
        XCTAssertEqual(m.lastMessageChanged(isOwn: false), .stick(animated: true))
    }

    func testJumpTappedRepinsAndSticks() {
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        _ = m.contentChanged(to: frame(top: -2300, height: 3400))
        XCTAssertEqual(m.jumpTapped(), .stick(animated: true))
        XCTAssertTrue(m.pinned)
    }

    /// The settle pass (#280) serves only an untouched, pinned, unfocused list.
    func testSettleCommandGates() {
        var m = dragModel(content: frame(top: -3000, height: 3400))
        XCTAssertEqual(m.settleCommand(), .stick(animated: false))
        m.focusActive = true
        XCTAssertEqual(m.settleCommand(), .none)
        m.focusActive = false
        m.dragBegan()
        m.dragEnded()
        XCTAssertEqual(m.settleCommand(), .none)
    }

    /// Engaging a jump unpins, so the follow can't yank the reader off the
    /// message they came to see.
    func testFocusEngagedUnpins() {
        var m = dragModel(content: frame(top: -2600, height: 3400))
        m.focusEngaged()
        XCTAssertFalse(m.pinned)
        XCTAssertTrue(m.focusActive)
        XCTAssertEqual(m.lastMessageChanged(isOwn: false), .none)
    }

    /// Scroll memory's two landings (macOS channel entry).
    func testPositionRestored() {
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        m.positionRestored(atBottom: false)
        XCTAssertFalse(m.pinned)
        m.positionRestored(atBottom: true)
        XCTAssertTrue(m.pinned)
    }

    // MARK: - The stick war (50%-blank channel opens)

    /// A resize while already essentially stuck must NOT re-stick: the no-op
    /// scrollTo forces a LazyVStack re-estimate, which resizes the content,
    /// which triggers the next stick — forever. The blank screen was the
    /// estimate-inflated phase of exactly that loop.
    func testAlignedResizeIsQuiet() {
        // Correctly stuck: content bottom 8pt below the viewport bottom (the
        // list's bottom padding hangs off-screen).
        var m = dragModel(content: frame(top: -2608, height: 3408)) // maxY 800+8
        // Estimates resolve: the content grows far past the bottom while the
        // reader hasn't moved — the OLD frame was aligned, so nothing fires…
        XCTAssertEqual(m.contentChanged(to: frame(top: -2608, height: 3400)), .none)
        // …including the settle belt.
        XCTAssertEqual(m.settleCommand(), .none)
    }

    /// A tiny viewport flap (the sync bar toggling is 2pt) while stuck must
    /// not scroll — same war, fed from the viewport side.
    func testAlignedViewportFlapIsQuiet() {
        var m = dragModel(content: frame(top: -2608, height: 3408))
        XCTAssertEqual(m.viewportChanged(to: 798), .none)
        XCTAssertEqual(m.viewportChanged(to: 800), .none)
        XCTAssertTrue(m.pinned)
    }

    /// The gate must never eat the real rescues: the estimate-inflated phase
    /// leaves the content bottom far below the viewport (blank over phantom
    /// space) — growth from an aligned start still sticks.
    func testInflatedPhaseStillResticks() {
        var m = dragModel(content: frame(top: -2608, height: 3408))
        XCTAssertEqual(
            m.contentChanged(to: frame(top: -2608, height: 7800)), .stick(animated: false))
    }

    // MARK: - The unpin-quiet window (burst arrivals)

    /// A burst of arrivals: our own animated follow's rebound frames move the
    /// top edge down mid-flight, exactly like an upward scroll. Within the
    /// quiet window that evidence is ignored — reading it unpinned the follow
    /// mid-burst and new messages silently stopped following (seen live with
    /// 50 rapid bot messages).
    func testReboundWithinQuietStaysPinned() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        XCTAssertEqual(
            m.contentChanged(to: frame(top: -1400, height: 2400), at: t0),
            .stick(animated: true))
        // Mid-flight rebound 100ms later: top edge moved down, far from bottom.
        _ = m.contentChanged(to: frame(top: -1300, height: 2400), at: t0.addingTimeInterval(0.1))
        XCTAssertTrue(m.pinned)
    }

    /// The same top-edge movement outside the quiet window is a real scroll.
    func testUpwardScrollAfterQuietUnpins() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        _ = m.contentChanged(to: frame(top: -1400, height: 2400), at: t0)
        _ = m.contentChanged(to: frame(top: -1300, height: 2400), at: t0.addingTimeInterval(1.0))
        XCTAssertFalse(m.pinned)
    }

    /// Same protection on iOS: an own-message stick's animation frames must
    /// not trip the drag-distance unpin.
    func testDragDistanceQuietAfterOwnMessage() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        XCTAssertEqual(m.lastMessageChanged(isOwn: true, at: t0), .stick(animated: true))
        // Mid-flight frame: 300pt out, height stable — within quiet, no unpin.
        _ = m.contentChanged(to: frame(top: -2300, height: 3400), at: t0.addingTimeInterval(0.1))
        XCTAssertTrue(m.pinned)
        // The same reading a second later is a real back-scroll.
        _ = m.contentChanged(to: frame(top: -2300, height: 3400), at: t0.addingTimeInterval(1.0))
        XCTAssertFalse(m.pinned)
    }

    // MARK: - Landing quiet (field trail 2026-08-20)

    /// After a landing scroll, geometry noise must not flip the pin in
    /// EITHER direction. The field trail showed both: phantom unpins after
    /// bottom landings (records while parked at the bottom), and a phantom
    /// re-pin during restore drift that aborted the drift-corrector.
    func testLandingQuietFreezesRepin() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var m = model(.topEdge, viewport: 600, content: frame(top: -1100, height: 2000))
        m.positionRestored(atBottom: false) // a restore parked us mid-history
        m.landingIssued(at: t0)
        // Drift slides the content to within the re-pin slack mid-settle.
        _ = m.contentChanged(to: frame(top: -1380, height: 2000), at: t0.addingTimeInterval(0.1))
        XCTAssertFalse(m.pinned) // frozen: this is drift, not the reader
        // The same reading after the window is a real return to the bottom.
        _ = m.contentChanged(to: frame(top: -1380, height: 2000), at: t0.addingTimeInterval(1.0))
        XCTAssertTrue(m.pinned)
    }

    func testLandingQuietFreezesUnpin() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        m.positionRestored(atBottom: true) // a bottom landing
        m.landingIssued(at: t0)
        // Settle jiggle: top edge moves down a hair, still off the bottom.
        _ = m.contentChanged(to: frame(top: -1300, height: 2000), at: t0.addingTimeInterval(0.1))
        XCTAssertTrue(m.pinned) // frozen: no phantom unpin, no phantom record
    }

    /// The pill signal needs both "unpinned" and "visibly short of the end",
    /// so a stick that lands within the slack drops it.
    func testShowJumpRequiresDistance() {
        var m = dragModel(content: frame(top: -2600, height: 3400), dragged: true)
        _ = m.contentChanged(to: frame(top: -2300, height: 3400)) // 300pt out, unpinned
        XCTAssertTrue(m.showJump)
        _ = m.contentChanged(to: frame(top: -2550, height: 3400)) // back within slack
        XCTAssertFalse(m.showJump)
    }

    // MARK: - Incoming messages (#334)

    /// The reported bug: a reply arrives, the follow sticks to it before the
    /// row has a height, the landing comes up short — and the corrective glue
    /// fires inside the quiet window the stick itself opened. Growth is never
    /// reader intent, so the window must not eat it: the reply ends up below
    /// the fold otherwise, which is exactly what was seen on macOS.
    func testLateRowGrowthAfterArrivalStillGlues() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        XCTAssertEqual(m.lastMessageChanged(isOwn: false, at: t0), .stick(animated: true))
        // 80ms later the row's real height lands: the newest message is now
        // 300pt past the bottom edge.
        XCTAssertEqual(
            m.contentChanged(to: frame(top: -1400, height: 2300), at: t0.addingTimeInterval(0.08)),
            .stick(animated: false))
        XCTAssertTrue(m.pinned)
    }

    /// A streaming agent reply grows every few frames — every one of them
    /// inside a quiet window. Each growth re-sticks, so the bottom stays
    /// pinned while the answer renders.
    func testStreamingGrowthKeepsTheBottomPinned() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        _ = m.lastMessageChanged(isOwn: false, at: t0)
        var height: CGFloat = 2000
        for step in 1...4 {
            height += 120
            XCTAssertEqual(
                m.contentChanged(
                    to: frame(top: -1400, height: height),
                    at: t0.addingTimeInterval(0.05 * Double(step))),
                .stick(animated: false),
                "growth \(step) must glue")
        }
        XCTAssertTrue(m.pinned)
    }

    /// The correction is unanimated on purpose: an animated one would push
    /// `quietUntil` forward on every growth frame, and a reader who scrolls
    /// away from a long streaming reply would never be believed.
    func testGlueCorrectionDoesNotExtendTheQuietWindow() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        _ = m.lastMessageChanged(isOwn: false, at: t0) // quiet until t0+0.4
        _ = m.contentChanged(to: frame(top: -1400, height: 2300), at: t0.addingTimeInterval(0.1))
        // A genuine upward scroll once the original window has passed.
        _ = m.contentChanged(to: frame(top: -1100, height: 2300), at: t0.addingTimeInterval(0.5))
        XCTAssertFalse(m.pinned)
    }

    /// Read-back history is untouched by an arrival, growth and all (#111).
    func testArrivalWhileBackScrolledMovesNothing() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        _ = m.contentChanged(to: frame(top: -900, height: 2000), at: t0) // scroll up
        XCTAssertFalse(m.pinned)
        XCTAssertEqual(m.lastMessageChanged(isOwn: false, at: t0), .none)
        XCTAssertEqual(
            m.contentChanged(to: frame(top: -900, height: 2300), at: t0.addingTimeInterval(0.08)),
            .none)
        XCTAssertFalse(m.pinned)
    }

    /// The arrival settle belt: unlike the open-the-channel settle it survives
    /// a reader who has dragged before (they are back at the bottom now), and
    /// like it, it stands down for anyone who owns the position.
    func testArrivalSettleGates() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var m = model(.topEdge, viewport: 600, content: frame(top: -1400, height: 2000))
        // A row sized late: the newest message sits 300pt below the fold.
        _ = m.contentChanged(to: frame(top: -1400, height: 2300), at: t0)
        XCTAssertEqual(m.arrivalSettleCommand(), .stick(animated: false))
        m.dragBegan()
        XCTAssertEqual(m.arrivalSettleCommand(), .none) // a finger on the list owns it
        m.dragEnded()
        XCTAssertEqual(m.arrivalSettleCommand(), .stick(animated: false)) // …but not after
        XCTAssertEqual(m.settleCommand(), .none) // the open-time belt is spent
        m.focusActive = true
        XCTAssertEqual(m.arrivalSettleCommand(), .none)
        m.focusActive = false
        // A real back-scroll, once the glue's quiet window has passed.
        _ = m.contentChanged(to: frame(top: -1100, height: 2300), at: t0.addingTimeInterval(1))
        XCTAssertFalse(m.pinned)
        XCTAssertEqual(m.arrivalSettleCommand(), .none)
    }

    /// Already stuck: the settle must not fire a no-op scroll (the layout war
    /// `alignedSlack` exists to end).
    func testArrivalSettleQuietWhenAligned() {
        var m = model(.topEdge, viewport: 600, content: frame(top: -1408, height: 2000))
        XCTAssertEqual(m.arrivalSettleCommand(), .none)
        XCTAssertTrue(m.pinned)
    }
}
