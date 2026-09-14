import XCTest
@testable import Flow

final class MessageDeletePolicyTests: XCTestCase {
    func testMemberCanOnlySoftDeleteOwnLiveMessage() {
        XCTAssertEqual(
            MessageDeletePolicy.mode(
                isMine: true, isDeleted: false, isSystem: false,
                canPermanentlyDelete: false
            ),
            .soft
        )
        XCTAssertNil(MessageDeletePolicy.mode(
            isMine: false, isDeleted: false, isSystem: false,
            canPermanentlyDelete: false
        ))
        XCTAssertNil(MessageDeletePolicy.mode(
            isMine: true, isDeleted: true, isSystem: false,
            canPermanentlyDelete: false
        ))
    }

    func testOwnerOrAdminCapabilityPermanentlyDeletesMessagesAndTombstones() {
        XCTAssertEqual(
            MessageDeletePolicy.mode(
                isMine: false, isDeleted: false, isSystem: false,
                canPermanentlyDelete: true
            ),
            .permanent
        )
        XCTAssertEqual(
            MessageDeletePolicy.mode(
                isMine: false, isDeleted: true, isSystem: false,
                canPermanentlyDelete: true
            ),
            .permanent
        )
    }

    func testSystemMessagesNeverGetTheAction() {
        XCTAssertNil(MessageDeletePolicy.mode(
            isMine: false, isDeleted: false, isSystem: true,
            canPermanentlyDelete: true
        ))
    }
}
