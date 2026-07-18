import Foundation
import SwiftUI

/// Rendering of stored mention tokens: `<@userId>` (user mentions) and
/// `<!channel|here|everyone>` (group mentions). Bodies keep tokens on the wire
/// so renames stay correct (phase2.md §4); clients translate at display time.
enum MentionRendering {
    static var userToken: Regex<(Substring, Substring)> { /<@([0-9a-fA-F-]{36})>/ }
    static var groupToken: Regex<(Substring, Substring)> { /<!(channel|here|everyone)>/ }

    /// Token-free plain text (banners, notification previews).
    static func plainText(_ body: String, names: [String: String] = [:]) -> String {
        var out = body
        for match in body.matches(of: userToken).reversed() {
            let id = String(match.1)
            out = out.replacingOccurrences(
                of: String(match.0),
                with: "@\(names[id] ?? "someone")"
            )
        }
        out = out.replacing(groupToken) { "@\($0.1)" }
        return out
    }

    /// Markdown-rendered body with mention pills. Highlights mentions of the
    /// current user (and group mentions) more strongly.
    static func attributed(
        _ body: String,
        names: [String: String],
        currentUserId: String?
    ) -> AttributedString {
        // Render markdown on the raw body first, then restyle mention tokens
        // inside the attributed result so markdown offsets stay consistent.
        var result = markdown(body)
        restyle(&result, regex: userToken) { id in
            (text: "@\(names[id] ?? "someone")", strong: id == currentUserId)
        }
        restyle(&result, regex: groupToken) { token in
            (text: "@\(token)", strong: true)
        }
        return result
    }

    private static func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        )) ?? AttributedString(text)
    }

    private static func restyle(
        _ attr: inout AttributedString,
        regex: some RegexComponent,
        transform: (String) -> (text: String, strong: Bool)
    ) {
        while true {
            let plain = String(attr.characters)
            guard let match = plain.firstMatch(of: regex) else { return }
            // capture group 1 is the id/token
            let captured = String(plain[match.range]).dropFirst(2).dropLast(1)
            let inner = captured.first == "@" ? String(captured.dropFirst()) : String(captured)
            let (text, strong) = transform(inner)
            guard let lower = AttributedString.Index(match.range.lowerBound, within: attr),
                  let upper = AttributedString.Index(match.range.upperBound, within: attr)
            else { return }
            var pill = AttributedString(text)
            pill.foregroundColor = strong ? .white : .accentColor
            pill.backgroundColor = strong ? Color.accentColor : Color.accentColor.opacity(0.15)
            pill.font = .callout.bold()
            attr.replaceSubrange(lower..<upper, with: pill)
        }
    }
}
