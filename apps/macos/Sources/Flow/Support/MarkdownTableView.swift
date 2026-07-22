import SwiftUI

/// A rendered GFM pipe table (MarkdownBlocks.Segment.table) — shared by the
/// macOS and iOS message lists, matching the web client's table styling:
/// hairline cell borders, a tinted header row, per-column alignment from the
/// separator row's colons, and horizontal scrolling when the table is wider
/// than the bubble.
///
/// Cells run through MentionRendering like any other body text, so mention
/// pills and inline markdown work inside a table.
struct MarkdownTableView: View {
    let header: [String]
    let align: [MarkdownBlocks.CellAlign?]
    let rows: [[String]]
    let userNames: [String: String]
    let currentUserId: String?

    /// Columns are sized by the widest cell, so every row must offer the same
    /// number of cells — ragged rows (a common hand-written table) are padded
    /// with empties and over-long ones truncated, mirroring GFM.
    private var columnCount: Int { header.count }

    // Deliberately NOT wrapped in a horizontal ScrollView: a scroll view
    // proposes an unbounded width, so cells can't expand to their column and
    // every border hugs its own text instead of forming a grid. Filling the
    // bubble width and wrapping long cells keeps the rules aligned.
    var body: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(0..<columnCount, id: \.self) { column in
                    cell(header[safe: column] ?? "", column: column, isHeader: true)
                        .gridColumnAlignment(columnAlignment(column))
                }
            }
            ForEach(rows.indices, id: \.self) { row in
                GridRow {
                    ForEach(0..<columnCount, id: \.self) { column in
                        cell(rows[row][safe: column] ?? "", column: column, isHeader: false)
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(MC.hairline, lineWidth: 1))
        .accessibilityIdentifier("msg.table")
    }

    private func cell(_ text: String, column: Int, isHeader: Bool) -> some View {
        Text(MentionRendering.attributed(text, names: userNames, currentUserId: currentUserId))
            .font(.system(size: 13, weight: isHeader ? .semibold : .regular))
            .foregroundStyle(MC.ink)
            .multilineTextAlignment(textAlignment(column))
            .fixedSize(horizontal: false, vertical: true) // wrap, never truncate
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            // Fill the whole column so adjacent borders meet as one grid.
            .frame(maxWidth: .infinity, alignment: cellAlignment(column))
            .background(isHeader ? MC.daypill : Color.clear)
            .border(MC.hairline, width: 0.5)
    }

    // MARK: - Alignment (nil = unset → leading, as on web)

    private func columnAlignment(_ column: Int) -> HorizontalAlignment {
        switch align[safe: column] ?? nil {
        case .center: .center
        case .right: .trailing
        case .left, nil: .leading
        }
    }

    private func cellAlignment(_ column: Int) -> Alignment {
        switch align[safe: column] ?? nil {
        case .center: .center
        case .right: .trailing
        case .left, nil: .leading
        }
    }

    private func textAlignment(_ column: Int) -> TextAlignment {
        switch align[safe: column] ?? nil {
        case .center: .center
        case .right: .trailing
        case .left, nil: .leading
        }
    }
}

private extension Array {
    /// Ragged markdown tables are common; index out of range must not crash a
    /// whole message list.
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
