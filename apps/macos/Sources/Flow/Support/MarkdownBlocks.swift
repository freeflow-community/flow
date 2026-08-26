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
        /// A ```mermaid fence (#229). Held apart from `.code` so the views can
        /// draw it as a diagram; the payload is the source, verbatim.
        case mermaid(String)
        /// An ATX heading. `level` is 1...6; the hashes and the whitespace
        /// after them are stripped, so `text` is the inline content.
        case heading(level: Int, text: String)
        /// A GFM pipe table. `align` is per column and may be shorter than
        /// `header` when the separator row has fewer cells; nil = unset.
        case table(header: [String], align: [CellAlign?], rows: [[String]])
        /// A run of bullet-list lines with their markers stripped. `-`, `*`
        /// and `+` are one list, as on web — mixing them doesn't split it.
        case ulist(items: [String])
        /// A run of numbered lines, markers stripped. `start` is the first
        /// item's number, so `3.` `4.` renders starting at 3 (web's `<ol
        /// start>`); the rest are numbered sequentially from it.
        case olist(start: Int, items: [String])
        /// A horizontal rule (`---`, `***`, `___`).
        case hr
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
    /// hidden), runs of consecutive quote lines (markers stripped), ATX
    /// headings (hashes stripped), GFM tables, bullet and numbered list runs
    /// (markers stripped), horizontal rules, and plain paragraph runs.
    /// Whitespace-only paragraph runs are dropped.
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
                let language = fenceLanguage(text[i])
                var content: [Substring] = []
                var j = i + 1
                while j < raw.count, ks[j] == .code {
                    content.append(strippingNewline(raw[j]))
                    j += 1
                }
                if j < raw.count, ks[j] == .fence { j += 1 } // closing fence
                let body = content.joined(separator: "\n")
                // An empty ```mermaid block has nothing to draw, so it stays a
                // code block — same rule as web's segmentBody.
                let isDiagram = language == "mermaid"
                    && !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                segs.append(isDiagram ? .mermaid(body) : .code(body))
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
                // A plain run can contain headings and tables; flush the prose
                // accumulated so far whenever one starts, then resume after it.
                var content: [String] = []
                var j = i
                func flushParagraph() {
                    let joined = content.joined(separator: "\n")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    if !joined.isEmpty { segs.append(.paragraph(joined)) }
                    content.removeAll()
                }
                while j < raw.count, ks[j] == .plain {
                    // Headings are checked before tables, as on web: a heading
                    // line that happens to contain a pipe is still a heading.
                    if let heading = parseHeading(text[j]) {
                        flushParagraph()
                        segs.append(.heading(level: heading.level, text: heading.text))
                        j += 1
                        continue
                    }
                    // Rules are checked before tables, as on web: `a | b`
                    // followed by `---` is prose plus a rule, not a table,
                    // because the separator carries no pipe.
                    if isHorizontalRule(text[j]) {
                        flushParagraph()
                        segs.append(.hr)
                        j += 1
                        continue
                    }
                    if isTableStart(text, ks, j) {
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
                        continue
                    }
                    if parseBulletItem(text[j]) != nil {
                        flushParagraph()
                        var items: [String] = []
                        while j < raw.count, ks[j] == .plain, let item = parseBulletItem(text[j]) {
                            items.append(item)
                            j += 1
                        }
                        segs.append(.ulist(items: items))
                        continue
                    }
                    if let first = parseNumberedItem(text[j]) {
                        flushParagraph()
                        var items: [String] = []
                        while j < raw.count, ks[j] == .plain, let item = parseNumberedItem(text[j]) {
                            items.append(item.text)
                            j += 1
                        }
                        segs.append(.olist(start: first.start, items: items))
                        continue
                    }
                    content.append(text[j])
                    j += 1
                }
                flushParagraph()
                i = j
            case .code:
                i += 1 // unreachable: code lines are consumed by the fence case
            }
        }
        return segs
    }

    // MARK: - Fence info strings

    /// The info string of an opening fence — `mermaid` in "```mermaid". Case
    /// and surrounding space are ignored and only the first word counts, so
    /// "```Mermaid  " and "```mermaid theme=x" both name mermaid. The twin of
    /// web's `fenceLanguage` (packages/web/src/lib/format.tsx), so all three
    /// clients agree on what is a diagram.
    static func fenceLanguage(_ line: String) -> String {
        let afterIndent = line.drop(while: { $0 == " " || $0 == "\t" })
        guard afterIndent.hasPrefix("```") else { return "" }
        let info = afterIndent.dropFirst(3).trimmingCharacters(in: .whitespaces)
        let firstWord = info.prefix(while: { !$0.isWhitespace })
        return firstWord.lowercased()
    }

    // MARK: - ATX headings

    /// An ATX heading line, or nil. Mirrors the web client's
    /// `HEADING_RE = /^(#{1,6})\s+(.*)$/` (packages/web/src/lib/format.tsx):
    /// 1–6 hashes at the very start of the line, at least one whitespace
    /// character after them, and the rest of the line as inline content. So
    /// seven hashes is prose, and so is `#hashtag` with no space. Callers
    /// pass only `.plain` lines, which is what keeps `#` inside a fence code.
    static func parseHeading(_ line: String) -> (level: Int, text: String)? {
        var level = 0
        var i = line.startIndex
        while i < line.endIndex, line[i] == "#" {
            level += 1
            if level > 6 { return nil }
            i = line.index(after: i)
        }
        guard level > 0, i < line.endIndex, line[i].isWhitespace else { return nil }
        // `\s+` is greedy on web, so the content never keeps leading spaces.
        return (level, String(line[i...].drop(while: \.isWhitespace)))
    }

    // MARK: - Lists and rules
    //
    // Same grammar as the web client (packages/web/src/lib/format.tsx), and
    // deliberately as shallow as it is there: no nesting, no lazy
    // continuation lines. Callers pass only `.plain` lines, which is what
    // keeps a marker inside a fence code.

    /// A bullet-list item's content, or nil. Mirrors web's
    /// `ULIST_RE = /^\s*[-*+]\s+(.*)$/`: optional indent, one of `-`/`*`/`+`,
    /// then at least one space. So `-no-space` is prose and `---` is a rule,
    /// not a one-item list.
    static func parseBulletItem(_ line: String) -> String? {
        var i = line.startIndex
        while i < line.endIndex, line[i].isWhitespace { i = line.index(after: i) }
        guard i < line.endIndex, line[i] == "-" || line[i] == "*" || line[i] == "+" else { return nil }
        i = line.index(after: i)
        guard i < line.endIndex, line[i].isWhitespace else { return nil }
        // `\s+` is greedy on web, so the content keeps no leading spaces.
        return String(line[i...].drop(while: \.isWhitespace))
    }

    /// A numbered item's start index and content, or nil. Mirrors web's
    /// `OLIST_RE = /^\s*(\d+)\.\s+(.*)$/` — ASCII digits only, a literal dot,
    /// then whitespace.
    static func parseNumberedItem(_ line: String) -> (start: Int, text: String)? {
        var i = line.startIndex
        while i < line.endIndex, line[i].isWhitespace { i = line.index(after: i) }
        var digits = ""
        while i < line.endIndex, line[i].isASCII, line[i].isNumber {
            digits.append(line[i])
            i = line.index(after: i)
        }
        guard !digits.isEmpty, i < line.endIndex, line[i] == "." else { return nil }
        i = line.index(after: i)
        guard i < line.endIndex, line[i].isWhitespace else { return nil }
        // An unrepresentable index falls back to 1, as web's !isFinite does.
        return (Int(digits) ?? 1, String(line[i...].drop(while: \.isWhitespace)))
    }

    /// A horizontal rule: three or more of `-`, `*` or `_`, all the same,
    /// with nothing but trailing whitespace after them. Web's
    /// `HR_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/` — note no leading indent.
    static func isHorizontalRule(_ line: String) -> Bool {
        guard let marker = line.first, marker == "-" || marker == "*" || marker == "_" else { return false }
        let run = line.prefix(while: { $0 == marker })
        guard run.count >= 3 else { return false }
        return line[run.endIndex...].allSatisfy(\.isWhitespace)
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
