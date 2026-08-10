import SwiftUI

/// "What's new" sheet: renders the user-facing FEATURES.md, bundled into the
/// .app by make-app.sh. Opened from the "Version …" label at the foot of the
/// workspace menu (web parity). macOS's message MarkdownBlocks doesn't cover
/// headings/lists, so this file renders the doc's subset (## / ### headings,
/// `-` bullets, paragraphs) from the blocks `FeatureNotes` parses, with inline
/// **bold**/`code`/links via AttributedString. iOS renders the same blocks in
/// FeaturesSheet.swift.
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
