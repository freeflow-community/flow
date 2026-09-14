import Foundation
import SwiftUI

extension FileAttachment {
    var isMarkdownReport: Bool {
        mimeType.split(separator: ";").first?.lowercased() == "text/markdown"
            || ["md", "markdown"].contains((name as NSString).pathExtension.lowercased())
    }
}

enum ArtifactReference {
    static func parse(_ body: String) -> (title: String, id: String)? {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("["), trimmed.hasSuffix(")"),
              let delimiter = trimmed.range(of: "](flow-artifact:") else { return nil }
        let id = String(trimmed[delimiter.upperBound..<trimmed.index(before: trimmed.endIndex)])
        guard UUID(uuidString: id) != nil else { return nil }
        return (String(trimmed[trimmed.index(after: trimmed.startIndex)..<delimiter.lowerBound]), id)
    }
}

struct ArtifactOpenButton: View {
    let title: String
    let artifactId: String
    @EnvironmentObject private var app: AppState
    #if os(macOS)
    @EnvironmentObject private var win: WindowState
    #endif
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                busy = true
                error = nil
                Task { @MainActor in
                    defer { busy = false }
                    do {
                        #if os(macOS)
                        try await app.openReport(id: artifactId, in: win)
                        #else
                        try await app.openReport(id: artifactId)
                        #endif
                    }
                    catch { self.error = "Could not open this report. Try again; it may have been deleted or access changed." }
                }
            } label: {
                Label(busy ? "Opening report…" : title, systemImage: "doc.text")
                    .padding(12)
            }
            .buttonStyle(.bordered)
            .disabled(busy)
            .accessibilityIdentifier("artifact.openReport")
            if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
        }
    }
}

/// Uses the same safe Markdown grammar as messages; raw HTML is never executed.
struct ReportMarkdownView: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(MarkdownBlocks.segments(text).enumerated()), id: \.offset) { _, segment in
                switch segment {
                case .table(let header, let align, let rows):
                    ScrollView(.horizontal) {
                        MarkdownTableView(header: header, align: align, rows: rows, userNames: [:], currentUserId: nil)
                    }
                case .code(let content):
                    ScrollView(.horizontal) {
                        Text(content).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    }
                case .quote(let content):
                    Text(MentionRendering.attributed(content, names: [:], currentUserId: nil))
                        .padding(.leading, 12).foregroundStyle(.secondary)
                case .heading(let level, let content):
                    Text(MentionRendering.attributed(content, names: [:], currentUserId: nil))
                        .font(level == 1 ? .title2 : .headline)
                case .mermaid(let content):
                    Text(content).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                case .ulist(let items):
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        Text(MentionRendering.attributed("• " + item, names: [:], currentUserId: nil))
                    }
                case .olist(let start, let items):
                    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                        Text(MentionRendering.attributed("\(start + index). " + item, names: [:], currentUserId: nil))
                    }
                case .hr:
                    Divider()
                case .paragraph(let content):
                    ForEach(Array(content.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                        let hashes = line.prefix(while: { $0 == "#" }).count
                        if (1...6).contains(hashes), line.dropFirst(hashes).hasPrefix(" ") {
                            Text(MentionRendering.attributed(String(line.dropFirst(hashes + 1)), names: [:], currentUserId: nil))
                                .font(hashes == 1 ? .title2 : .headline).padding(.top, 6)
                        } else {
                            Text(MentionRendering.attributed(line, names: [:], currentUserId: nil)).textSelection(.enabled)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("artifact.markdown")
    }
}
