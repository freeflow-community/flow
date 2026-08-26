import SwiftUI

/// "What's new" sheet (web + macOS parity): the user-facing release notes from
/// FEATURES.md, opened from the version row at the foot of the drawer's
/// workspace menu.
///
/// The notes are bundled into the app by the "Bundle FEATURES.md" build phase
/// (`apps/ios/project.yml`), the same way `make-app.sh` bundles them on macOS.
/// So this screen shows exactly the notes of the installed build — never a
/// feature the build doesn't have — and works with no network.
///
/// Rendering matches `FeaturesView` on macOS — the same `FeatureNotes.parse`
/// blocks (## / ### headings, `-` bullets, paragraphs) with inline
/// **bold**/`code`/links via AttributedString.
struct FeaturesSheet: View {
    @Environment(\.dismiss) private var dismiss
    private let blocks: [FeatureBlock]

    init() {
        blocks = FeatureNotes.parse(FeatureNotes.load())
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("What's new")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                            .accessibilityIdentifier("features.done")
                    }
                }
        }
        .accessibilityIdentifier("featuresSheet")
    }

    @ViewBuilder
    private var content: some View {
        if blocks.isEmpty {
            // Only reachable from a build whose FEATURES.md never got bundled —
            // say so rather than showing an empty page.
            VStack(spacing: 10) {
                Image(systemName: "doc.text")
                    .font(.system(size: 34))
                    .foregroundStyle(MC.faint)
                Text("Release notes aren't available.")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(MC.ink)
                    .accessibilityIdentifier("features.error.title")
                Text("This build of Flow didn't ship with them.")
                    .font(.system(size: 13))
                    .foregroundStyle(MC.faint)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                        view(for: block)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .padding(16)
            }
            .accessibilityIdentifier("features.notes")
        }
    }

    @ViewBuilder
    private func view(for block: FeatureBlock) -> some View {
        switch block {
        case let .heading(level, text):
            Text(FeatureNotes.inline(text))
                .font(.system(size: headingSize(level), weight: .bold))
                .foregroundStyle(MC.ink)
                .padding(.top, level <= 2 ? 10 : 4)
        case let .bullet(text):
            HStack(alignment: .top, spacing: 8) {
                Text("•").foregroundStyle(MC.faint)
                Text(FeatureNotes.inline(text)).foregroundStyle(MC.inkSoft)
            }
            .font(.system(size: 15))
        case let .paragraph(text):
            Text(FeatureNotes.inline(text))
                .font(.system(size: 15))
                .foregroundStyle(MC.inkSoft)
        case .rule:
            Divider().padding(.vertical, 2)
        }
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case ...1: return 22
        case 2: return 18
        default: return 15
        }
    }
}
