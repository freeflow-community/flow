import SwiftUI

/// "What's new" sheet: renders the user-facing FEATURES.md. Opened from the
/// "Build …" label at the foot of the workspace menu (web parity). macOS's
/// message MarkdownBlocks doesn't cover headings/lists, so this file carries a
/// small renderer for the doc's subset (## / ### headings, `-` bullets,
/// paragraphs) with inline **bold**/`code`/links via AttributedString.
struct FeaturesView: View {
    @Environment(\.dismiss) private var dismiss
    private let blocks: [FeatureBlock]

    init() {
        blocks = FeatureNotes.parse(FeatureNotes.load())
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("What's new")
                    .flowFont(size: 15, weight: .bold)
                    .foregroundStyle(MC.ink)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 7) {
                    if blocks.isEmpty {
                        Text("Release notes aren't available.")
                            .foregroundStyle(MC.faint)
                    } else {
                        ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                            view(for: block)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .padding(16)
            }
        }
        .frame(width: 560, height: 620)
        .accessibilityIdentifier("featuresSheet")
    }

    @ViewBuilder
    private func view(for block: FeatureBlock) -> some View {
        switch block {
        case let .heading(level, text):
            Text(FeatureNotes.inline(text))
                .flowFont(size: headingSize(level), weight: .bold)
                .foregroundStyle(MC.ink)
                .padding(.top, level <= 2 ? 8 : 3)
        case let .bullet(text):
            HStack(alignment: .top, spacing: 8) {
                Text("•").foregroundStyle(MC.faint)
                Text(FeatureNotes.inline(text)).foregroundStyle(MC.inkSoft)
            }
        case let .paragraph(text):
            Text(FeatureNotes.inline(text)).foregroundStyle(MC.inkSoft)
        case .rule:
            Divider().padding(.vertical, 2)
        }
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case ...1: return 20
        case 2: return 16
        default: return 13
        }
    }
}

/// One rendered line/paragraph of the notes.
enum FeatureBlock {
    case heading(Int, String)
    case bullet(String)
    case paragraph(String)
    case rule
}

enum FeatureNotes {
    /// Loads FEATURES.md, bundled into the .app by make-app.sh. Dev fallback
    /// (bare `swift run`, no bundle): walk from this source file up to the repo
    /// root — resolves only on the build machine, harmless otherwise.
    static func load() -> String {
        if let url = Bundle.main.url(forResource: "FEATURES", withExtension: "md"),
           let s = try? String(contentsOf: url, encoding: .utf8) {
            return s
        }
        var root = URL(fileURLWithPath: #filePath)
        // …/Sources/Flow/Views/FeaturesView.swift → repo root (6 levels up).
        for _ in 0..<6 { root.deleteLastPathComponent() }
        return (try? String(contentsOf: root.appendingPathComponent("FEATURES.md"), encoding: .utf8)) ?? ""
    }

    /// Inline markdown → AttributedString (**bold**, *italic*, `code`, links).
    static func inline(_ s: String) -> AttributedString {
        (try? AttributedString(
            markdown: s,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(s)
    }

    /// Split the doc into blocks. Continuation lines (indented, no marker) fold
    /// into the current bullet/paragraph so wrapped source lines render as one.
    static func parse(_ md: String) -> [FeatureBlock] {
        var out: [FeatureBlock] = []
        var pending: (isBullet: Bool, text: String)?

        func flush() {
            if let p = pending {
                out.append(p.isBullet ? .bullet(p.text) : .paragraph(p.text))
                pending = nil
            }
        }

        for raw in md.components(separatedBy: "\n") {
            let indented = raw.hasPrefix(" ") || raw.hasPrefix("\t")
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                flush()
            } else if line == "---" {
                flush()
                out.append(.rule)
            } else if let (level, text) = heading(line) {
                flush()
                out.append(.heading(level, text))
            } else if line.hasPrefix("- ") {
                flush()
                pending = (true, String(line.dropFirst(2)))
            } else if indented, pending != nil {
                pending!.text += " " + line
            } else if pending != nil, !pending!.isBullet {
                pending!.text += " " + line
            } else {
                flush()
                pending = (false, line)
            }
        }
        flush()
        return out
    }

    /// `## Heading` → (level, text); nil if not an ATX heading.
    private static func heading(_ s: String) -> (Int, String)? {
        var level = 0
        var idx = s.startIndex
        while idx < s.endIndex, s[idx] == "#" {
            level += 1
            idx = s.index(after: idx)
        }
        guard level > 0, idx < s.endIndex, s[idx] == " " else { return nil }
        return (level, String(s[s.index(after: idx)...]))
    }
}
