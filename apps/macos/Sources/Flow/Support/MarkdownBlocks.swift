import Foundation

/// Block-level parsing for the two supported markdown block constructs:
/// blockquotes (lines starting with ">") and fenced code blocks (```).
/// Bodies stay literal markdown on the wire (phase-3.5 ruling 2); this shared
/// classifier drives the composer's live attribute pass, message rendering,
/// and the outgoing-transform fence guard — one grammar, three consumers.
enum MarkdownBlocks {
    enum LineKind: Equatable {
        case plain
        case quote
        case fence // a ``` marker line (opening or closing)
        case code  // a line inside a fenced region
    }

    /// Column alignment from a GFM separator row's colons (`:--`, `:-:`, `--:`).
    enum CellAlign: Equatable {
        case left
        case center
        case right
    }

    enum Segment: Equatable {
        case paragraph(String)
        case quote(String) // ">"/"> " markers stripped, lines joined with \n
        case code(String)  // fence marker lines dropped
        /// A GFM pipe table. `align` is per column and may be shorter than
        /// `header` when the separator row has fewer cells; nil = unset.
        case table(header: [String], align: [CellAlign?], rows: [[String]])
    }

    /// Splits into lines KEEPING each line's trailing "\n" so concatenating
    /// the lines reproduces the input exactly.
    static func lines(_ text: String) -> [Substring] {
        var out: [Substring] = []
        var start = text.startIndex
        var i = text.startIndex
        while i < text.endIndex {
            let next = text.index(after: i)
            if text[i] == "\n" {
                out.append(text[start..<next])
                start = next
            }
            i = next
        }
        if start < text.endIndex { out.append(text[start...]) }
        return out
    }

    /// One kind per line. A fence line toggles code state; everything between
    /// an opening fence and the closing fence (or end of text) is code.
    /// Quote/plain classification only applies outside code regions.
    static func kinds(of lines: [Substring]) -> [LineKind] {
        var kinds: [LineKind] = []
        var inCode = false
        for line in lines {
            if line.drop(while: { $0 == " " || $0 == "\t" }).hasPrefix("```") {
                kinds.append(.fence)
                inCode.toggle()
            } else if inCode {
                kinds.append(.code)
            } else if line.hasPrefix(">") {
                kinds.append(.quote)
            } else {
                kinds.append(.plain)
            }
        }
        return kinds
    }

    /// Per-line kinds with UTF-16 ranges for NSTextStorage attribute passes.
    /// Ranges include the trailing newline so painted backgrounds have no gaps.
    static func classifiedLineRanges(_ text: String) -> [(range: NSRange, kind: LineKind)] {
        let ls = lines(text)
        var out: [(NSRange, LineKind)] = []
        var location = 0
        for (line, kind) in zip(ls, kinds(of: ls)) {
            let length = line.utf16.count
            out.append((NSRange(location: location, length: length), kind))
            location += length
        }
        return out
    }

    /// Splits the body into runs whose concatenation is exactly the input;
    /// `isCode` runs cover fence marker lines plus their content. Outgoing
    /// transforms (shortcodes, mentions) must only touch non-code runs.
    static func fenceSplit(_ body: String) -> [(text: String, isCode: Bool)] {
        let ls = lines(body)
        var out: [(text: String, isCode: Bool)] = []
        for (line, kind) in zip(ls, kinds(of: ls)) {
            let isCode = kind == .fence || kind == .code
            if let last = out.indices.last, out[last].isCode == isCode {
                out[last].text.append(contentsOf: line)
            } else {
                out.append((String(line), isCode))
            }
        }
        return out
    }

    /// Applies `transform` to non-code runs only, preserving fenced code
    /// regions byte-for-byte.
    static func mapNonCode(_ body: String, _ transform: (String) -> String) -> String {
        fenceSplit(body).map { $0.isCode ? $0.text : transform($0.text) }.joined()
    }

    /// Block segments for message rendering: fenced code blocks (markers
    /// hidden), runs of consecutive quote lines (markers stripped), and plain
    /// paragraph runs. Whitespace-only paragraph runs are dropped.
    static func segments(_ body: String) -> [Segment] {
        let raw = lines(body)
        let ks = kinds(of: raw)
        // Newline-stripped view: table detection needs to look ahead a line.
        let text = raw.map { String(strippingNewline($0)) }
        var segs: [Segment] = []
        var i = 0
        while i < raw.count {
            switch ks[i] {
            case .fence:
                var content: [Substring] = []
                var j = i + 1
                while j < raw.count, ks[j] == .code {
                    content.append(strippingNewline(raw[j]))
                    j += 1
                }
                if j < raw.count, ks[j] == .fence { j += 1 } // closing fence
                segs.append(.code(content.joined(separator: "\n")))
                i = j
            case .quote:
                var content: [String] = []
                var j = i
                while j < raw.count, ks[j] == .quote {
                    var line = strippingNewline(raw[j]).dropFirst() // ">"
                    if line.hasPrefix(" ") { line = line.dropFirst() }
                    content.append(String(line))
                    j += 1
                }
                segs.append(.quote(content.joined(separator: "\n")))
                i = j
            case .plain:
                // A plain run can contain tables; flush the prose accumulated
                // so far whenever one starts, then resume after it.
                var content: [String] = []
                var j = i
                func flushParagraph() {
                    let joined = content.joined(separator: "\n")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    if !joined.isEmpty { segs.append(.paragraph(joined)) }
                    content.removeAll()
                }
                while j < raw.count, ks[j] == .plain {
                    guard isTableStart(text, ks, j) else {
                        content.append(text[j])
                        j += 1
                        continue
                    }
                    flushParagraph()
                    let header = parseTableRow(text[j])
                    let align = parseTableRow(text[j + 1]).map(parseTableAlign)
                    var k = j + 2
                    var rows: [[String]] = []
                    // Body rows run until a line stops looking like one.
                    while k < raw.count, ks[k] == .plain, text[k].contains("|"),
                          !text[k].trimmingCharacters(in: .whitespaces).isEmpty {
                        rows.append(parseTableRow(text[k]))
                        k += 1
                    }
                    segs.append(.table(header: header, align: align, rows: rows))
                    j = k
                }
                flushParagraph()
                i = j
            case .code:
                i += 1 // unreachable: code lines are consumed by the fence case
            }
        }
        return segs
    }

    // MARK: - GFM pipe tables
    //
    // Same grammar as the web client (packages/web/src/lib/format.tsx): a
    // header row containing a pipe, immediately followed by a separator row of
    // pipes/dashes/optional colons. Outer pipes are optional.

    /// A separator row: pipes, dashes, optional colons — and at least one of
    /// each of pipe and dash.
    static func isTableSeparator(_ line: String) -> Bool {
        guard line.contains("|"), line.contains("-") else { return false }
        return line.allSatisfy { $0 == " " || $0 == "\t" || $0 == "|" || $0 == ":" || $0 == "-" }
    }

    /// Splits "| a | b |" into ["a", "b"], tolerating optional outer pipes.
    static func parseTableRow(_ line: String) -> [String] {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("|") { s.removeFirst() }
        if s.hasSuffix("|") { s.removeLast() }
        return s.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    static func parseTableAlign(_ cell: String) -> CellAlign? {
        let left = cell.hasPrefix(":")
        let right = cell.hasSuffix(":")
        if left, right { return .center }
        if right { return .right }
        if left { return .left }
        return nil
    }

    /// Does a table start at `i`? Header must carry a pipe and the next line
    /// must be a separator — and both must be plain (a fence or quote line
    /// ends the run before we get here).
    private static func isTableStart(_ text: [String], _ kinds: [LineKind], _ i: Int) -> Bool {
        guard text[i].contains("|"), i + 1 < text.count, kinds[i + 1] == .plain else { return false }
        return isTableSeparator(text[i + 1])
    }

    private static func strippingNewline(_ line: Substring) -> Substring {
        line.hasSuffix("\n") ? line.dropLast() : line
    }
}
