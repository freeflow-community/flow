import SwiftUI

/// Built-in help (#384): the same docs the web client shows, in a sheet —
/// topics down the left, the selected page rendered on the right, Home first
/// (web parity, `HelpModal.tsx`). Opened by the "?" at the foot of the
/// workspace rail; Done or Esc closes it.
///
/// Content comes from the server (`/v1/help`, #383) rather than the bundle, so
/// a help edit ships with the deploy and reaches installed apps without a
/// macOS release. Markdown goes through `MarkdownBlocks` — the grammar message
/// bodies use — via `HelpDoc`, so docs look like the rest of Flow.
struct HelpView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var topics: [HelpTopic] = []
    @State private var slug = HelpDoc.home
    @State private var page: HelpPage?
    /// Separate from the page's own failure: a topic list that didn't load
    /// leaves the whole sheet empty, whereas one page 404ing does not.
    @State private var topicsFailed = false
    @State private var pageFailed = false

    private static let topicColumnWidth: CGFloat = 200

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            HStack(spacing: 0) {
                topicList
                Divider()
                pageBody
            }
        }
        .frame(width: 840, height: 620)
        .background(MC.chat)
        .accessibilityIdentifier("helpSheet")
        .task { await loadTopics() }
        .task(id: slug) { await loadPage(slug) }
    }

    private var header: some View {
        HStack {
            Text("Help")
                .flowFont(size: 15, weight: .bold)
                .foregroundStyle(MC.ink)
            Spacer()
            Button("Done") { dismiss() }
                .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var topicList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(topics) { topic in
                    let selected = topic.slug == slug
                    Button {
                        slug = topic.slug
                    } label: {
                        Text(topic.title)
                            .flowFont(size: 13, weight: selected ? .semibold : nil)
                            .foregroundStyle(selected ? MC.ink : MC.inkSoft)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(selected ? MC.daypill : .clear)
                            )
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("help.topic.\(topic.slug)")
                    .accessibilityAddTraits(selected ? [.isSelected] : [])
                }
            }
            .padding(8)
        }
        .frame(width: Self.topicColumnWidth)
        .background(MC.base)
        .accessibilityIdentifier("help.topics")
    }

    @ViewBuilder
    private var pageBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if topicsFailed || pageFailed {
                    Text("Help isn't available right now.")
                        .foregroundStyle(MC.faint)
                } else if let page {
                    ForEach(Array(HelpDoc.blocks(page.markdown).enumerated()), id: \.offset) { _, block in
                        view(for: block)
                    }
                } else {
                    Text("Loading…").foregroundStyle(MC.faint)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
            .padding(20)
        }
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("help.page")
    }

    // MARK: Blocks

    @ViewBuilder
    private func view(for block: MarkdownBlocks.Segment) -> some View {
        switch block {
        case let .heading(level, text):
            inline(text)
                .flowFont(size: headingSize(level), weight: .bold)
                .foregroundStyle(MC.ink)
                .padding(.top, level <= 2 ? 8 : 3)
        case let .paragraph(text):
            inline(text).foregroundStyle(MC.inkSoft)
        case let .ulist(items):
            list(items.map { (marker: "•", text: $0) }, bulleted: true)
        case let .olist(start, items):
            list(items.enumerated().map { (marker: "\(start + $0.offset).", text: $0.element) }, bulleted: false)
        case let .quote(text):
            inline(HelpDoc.reflow(text))
                .foregroundStyle(MC.inkSoft)
                .padding(.leading, 11)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(MC.accent.opacity(0.55))
                        .frame(width: 3)
                }
        case let .code(text):
            Text(text.isEmpty ? " " : text)
                .flowFont(size: 12, design: .monospaced)
                .foregroundStyle(MC.ink)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 8).fill(MC.codeBg))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline, lineWidth: 1))
        case let .mermaid(source):
            MermaidDiagramView(source: source)
        case let .table(header, align, rows):
            // Docs have no mentions to resolve, so the table renders with an
            // empty name map — @handles in a doc cell stay literal text.
            MarkdownTableView(
                header: header, align: align, rows: rows,
                userNames: [:], currentUserId: nil
            )
        case .hr:
            Rectangle()
                .fill(MC.hairline)
                .frame(height: 1)
                .padding(.vertical, 3)
        }
    }

    /// Marker column plus the inline pass on each item, the same shape message
    /// lists use, so `**bold**` and `code` still render inside an item.
    private func list(_ items: [(marker: String, text: String)], bulleted: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.marker)
                        .flowFont(.callout, weight: bulleted ? .bold : nil)
                        .foregroundStyle(MC.inkSoft)
                        .frame(minWidth: 14, alignment: .trailing)
                    inline(item.text)
                        .foregroundStyle(MC.inkSoft)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    /// Inline markdown (**bold**, `code`, links) — the same AttributedString
    /// pass the "What's new" sheet uses.
    private func inline(_ text: String) -> Text {
        Text(FeatureNotes.inline(text))
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case ...1: return 20
        case 2: return 16
        default: return 13
        }
    }

    // MARK: Loading

    private func loadTopics() async {
        do {
            let list = try await app.engine.helpTopics()
            topics = list
            topicsFailed = false
            // Home unless this server's docs directory has no home.md.
            if !list.contains(where: { $0.slug == slug }), let opening = HelpDoc.openingSlug(list) {
                slug = opening
            }
        } catch {
            topicsFailed = true
        }
    }

    private func loadPage(_ slug: String) async {
        page = nil
        pageFailed = false
        do {
            page = try await app.engine.helpPage(slug: slug)
        } catch {
            pageFailed = true
        }
    }
}
