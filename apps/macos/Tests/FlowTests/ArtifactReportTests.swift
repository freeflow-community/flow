import Foundation
import XCTest

@testable import Flow

final class ArtifactReportTests: XCTestCase {
    func testDurableReportReference() {
        let id = "01900000-0000-7000-a000-000000000001"
        let report = ArtifactReference.parse("[Open report: Sample](flow-artifact:\(id))")
        XCTAssertEqual(report?.id, id)
        XCTAssertEqual(report?.title, "Open report: Sample")
        XCTAssertNil(ArtifactReference.parse("[Open](flow-artifact:invalid)"))
        XCTAssertNil(ArtifactReference.parse("[Open](https://example.test)"))
    }

    func testReportContainsStructuredTableAndHeading() {
        let segments = MarkdownBlocks.segments("# Sample report\n\n| Item | Status |\n| --- | --- |\n| Check | Passed |")
        XCTAssertTrue(segments.contains { if case .heading(level: 1, text: "Sample report") = $0 { return true }; return false })
        XCTAssertTrue(segments.contains {
            if case .table(let header, _, let rows) = $0 {
                return header == ["Item", "Status"] && rows == [["Check", "Passed"]]
            }
            return false
        })
    }
}
