import XCTest
@testable import Flow

/// The connected-indicator rule (#508), which the connect chime (#509) rides
/// on. Same cases as the web client's huddleConnection.test.ts — the two
/// implementations have to agree, since the same call is drawn on both.
final class HuddleConnectionTests: XCTestCase {
    private func agent(_ userId: String = "u-agent", audioLive: Bool = true) -> HuddlePeerState {
        HuddlePeerState(userId: userId, audioLive: audioLive, isAgent: true)
    }

    private func person(_ userId: String = "u-ada", audioLive: Bool = false) -> HuddlePeerState {
        HuddlePeerState(userId: userId, audioLive: audioLive, isAgent: false)
    }

    func testIdleWhenNobodyElseIsExpected() {
        XCTAssertEqual(huddleConnection(peers: [], awaiting: []), .idle)
    }

    func testConnectingWhileAnAcceptedInviteHasNotArrived() {
        XCTAssertEqual(huddleConnection(peers: [], awaiting: ["u-agent"]), .connecting)
    }

    func testConnectingForAnAgentInTheRoomWithNoAudio() {
        XCTAssertEqual(huddleConnection(peers: [agent(audioLive: false)], awaiting: []), .connecting)
    }

    func testConnectedOnceTheAgentPublishesAudio() {
        XCTAssertEqual(huddleConnection(peers: [agent()], awaiting: []), .connected)
    }

    /// Everyone joins muted by decision — waiting for their audio would leave a
    /// working human call reading "connecting" until someone unmutes.
    func testAPersonCountsAsConnectedOnArrival() {
        XCTAssertEqual(huddleConnection(peers: [person()], awaiting: []), .connected)
    }

    func testClearsBackToIdleWhenThePeerLeaves() {
        XCTAssertEqual(huddleConnection(peers: [agent()], awaiting: []), .connected)
        XCTAssertEqual(huddleConnection(peers: [], awaiting: []), .idle)
    }

    func testOneLiveAgentAmongStragglersIsConnected() {
        let peers = [agent("u-a", audioLive: false), agent("u-b")]
        XCTAssertEqual(huddleConnection(peers: peers, awaiting: ["u-c"]), .connected)
    }

    func testChimesOnceACallIsUpAndOnlyOnce() {
        XCTAssertTrue(shouldChime(.connected, alreadyChimed: false))
        XCTAssertFalse(shouldChime(.connected, alreadyChimed: true))
    }

    func testNeverChimesForACallThatDoesNotConnect() {
        XCTAssertFalse(shouldChime(.connecting, alreadyChimed: false))
        XCTAssertFalse(shouldChime(.idle, alreadyChimed: false))
    }

    func testPeerConnectedOnlyDemandsAudioOfAgents() {
        XCTAssertFalse(peerConnected(agent(audioLive: false)))
        XCTAssertTrue(peerConnected(person()))
    }
}
