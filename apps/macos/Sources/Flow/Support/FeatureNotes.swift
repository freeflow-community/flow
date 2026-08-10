import Foundation

/// One rendered line/paragraph of the user-facing release notes (FEATURES.md).
enum FeatureBlock {
    case heading(Int, String)
    case bullet(String)
    case paragraph(String)
    case rule
}

/// Loading + parsing for FEATURES.md, shared by the macOS sheet (`FeaturesView`)
/// and the iOS sheet (`FeaturesSheet`). The doc is generated from the
/// `## Feature` sections of `changelog/` by `scripts/build-features.mjs`, so it
/// is never in the repo — each client gets it a different way:
///
/// - macOS bundles it (`tools/make-app.sh` copies it into Resources) → `load()`.
/// - iOS fetches it from the server, like the web client → `fetch()`. iOS
///   archives straight through `xcodebuild` with no shell wrapper to run the
///   generator, and fetched notes stay current between TestFlight builds.
///
/// The block renderer lives in each client's view; only the parse is shared,
/// because macOS's message `MarkdownBlocks` doesn't cover headings/lists.
enum FeatureNotes {
    /// Loads the bundled FEATURES.md (macOS). Dev fallback (bare `swift run`, no
    /// bundle): walk from this source file up to the repo root — resolves only
    /// on the build machine, harmless otherwise. Empty when there is none.
    static func load() -> String {
        if let url = Bundle.main.url(forResource: "FEATURES", withExtension: "md"),
           let s = try? String(contentsOf: url, encoding: .utf8) {
            return s
        }
        var root = URL(fileURLWithPath: #filePath)
        // …/Sources/Flow/Support/FeatureNotes.swift → repo root (6 levels up).
        for _ in 0..<6 { root.deleteLastPathComponent() }
        return (try? String(contentsOf: root.appendingPathComponent("FEATURES.md"), encoding: .utf8)) ?? ""
    }

    /// Fetches FEATURES.md from the server the app is signed in to (iOS). The
    /// server serves it as a static file out of the web dist, unauthenticated —
    /// same URL the web client's "What's new" lightbox uses.
    static func fetch() async throws -> String {
        var url = Server.baseURL.appendingPathComponent("FEATURES.md")
        #if DEBUG
        // QA hook (DEBUG-only, like FLOW_DEBUG_EMAIL): point *only* the notes
        // fetch somewhere else, so the failure path can be exercised with the
        // app still signed in — see UITests/FeaturesSheetTests.
        if let raw = ProcessInfo.processInfo.environment["FLOW_DEBUG_FEATURES_URL"],
           let override = URL(string: raw) {
            url = override
        }
        #endif
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadRevalidatingCacheData
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200, let text = String(data: data, encoding: .utf8) else {
            throw URLError(.badServerResponse)
        }
        return text
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
