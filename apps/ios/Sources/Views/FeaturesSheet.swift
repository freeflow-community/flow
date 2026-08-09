import SwiftUI

/// "What's new" sheet (web + macOS parity): the user-facing release notes from
/// FEATURES.md, opened from the version row at the foot of the drawer's
/// workspace menu.
///
/// FEATURES.md is generated and gitignored, and iOS archives straight through
/// `xcodebuild` with no shell wrapper to run the generator — so, like the web
/// client, iOS fetches it from the server rather than bundling it (see
/// `FeatureNotes.fetch`). That means the screen needs the network: a failed
/// fetch shows a readable message and a Retry, never a blank page.
///
/// Rendering matches `FeaturesView` on macOS — the same `FeatureNotes.parse`
/// blocks (## / ### headings, `-` bullets, paragraphs) with inline
/// **bold**/`code`/links via AttributedString.
struct FeaturesSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var state: LoadState = .loading

    private enum LoadState {
        case loading
        case loaded([FeatureBlock])
        case failed(String)
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
        .task { await load() }
        .accessibilityIdentifier("featuresSheet")
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("features.loading")

        case let .failed(message):
            VStack(spacing: 12) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 34))
                    .foregroundStyle(MC.faint)
                Text("Release notes aren't available.")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(MC.ink)
                    .accessibilityIdentifier("features.error.title")
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(MC.faint)
                    .multilineTextAlignment(.center)
                Button("Try Again") { Task { await load() } }
                    .font(.system(size: 15, weight: .semibold))
                    .accessibilityIdentifier("features.retry")
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case let .loaded(blocks):
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

    private func load() async {
        state = .loading
        do {
            let blocks = FeatureNotes.parse(try await FeatureNotes.fetch())
            state = blocks.isEmpty
                ? .failed("The server returned no notes.")
                : .loaded(blocks)
        } catch {
            // Name the server: the usual cause is no network, the next most
            // usual is an app pointed at a server that isn't running.
            state = .failed("Couldn't reach \(Server.displayName). Check your connection and try again.")
        }
    }
}
