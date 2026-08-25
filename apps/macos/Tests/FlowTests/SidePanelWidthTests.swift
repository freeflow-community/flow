import Foundation
import XCTest

@testable import Flow

/// #354: the side panel used to be framed at the stored preference no matter
/// how little room there was, so the three-column split came out wider than the
/// window and SwiftUI clipped it — rail off the leading edge, panel controls off
/// the trailing one. These pin the rule that replaced it.
final class SidePanelWidthTests: XCTestCase {
    private func width(_ preferred: Double, in available: Double) -> Double {
        MainView.sidePanelWidth(preferred: preferred, available: available)
    }

    /// The invariant the bug violated: the panel plus its drag strip never
    /// needs more room than the column was given, at any width.
    func testNeverOverflowsTheSpaceItWasGiven() {
        for available in stride(from: 200.0, through: 2400.0, by: 5) {
            for preferred in [320.0, 480.0, 720.0] {
                let w = width(preferred, in: available)
                XCTAssertLessThanOrEqual(w + 5, available, "panel \(w) overflows \(available)")
                XCTAssertGreaterThanOrEqual(w, 0)
            }
        }
    }

    /// With room to spare the preference is honoured exactly — the fix must not
    /// move the layout anyone is already using.
    func testWidePreferenceIsHonouredUntouched() {
        XCTAssertEqual(width(480, in: 1200), 480)
        XCTAssertEqual(width(720, in: 1600), 720)
        XCTAssertEqual(width(320, in: 900), 320)
    }

    /// The chat column keeps its 320pt as long as the panel can pay for it out
    /// of the preference — this is the half PR #351 was missing, which is why
    /// its 106pt chat column got reverted.
    func testChatKeepsItsMinimumBeforeThePanelDoes() {
        // 700pt of column, panel wants 480: it gets 375 so chat still gets 320.
        XCTAssertEqual(width(480, in: 700), 375)
        XCTAssertEqual(700 - 5 - width(480, in: 700), 320)
    }

    /// At the app's own minimum window width there is not enough for both
    /// columns' ideals, and the panel — the optional one — is what gives: chat
    /// still gets its 320 and the panel squeezes to 266. This is the case that
    /// used to throw the rail off-screen entirely.
    func testPanelYieldsBeforeChatDoes() {
        // 900pt window − 64 rail − 240 sidebar − 5 resizer = 591pt of column.
        XCTAssertEqual(width(720, in: 591), 266)
        XCTAssertEqual(591 - 5 - width(720, in: 591), 320)
    }

    /// Past the panel's 240pt squeeze floor the chat column absorbs the
    /// shortfall instead — degraded, but still nothing clipped off the window.
    func testPanelStopsAtItsSqueezeFloor() {
        XCTAssertEqual(width(480, in: 500), 240)
        XCTAssertEqual(width(480, in: 400), 240)
    }

    /// And when even that floor will not fit, the panel yields the last of it
    /// rather than pushing the split past the window edge.
    func testFloorItselfYieldsWhenNothingFits() {
        XCTAssertEqual(width(480, in: 200), 195)
        XCTAssertEqual(width(480, in: 0), 0)
    }
}
