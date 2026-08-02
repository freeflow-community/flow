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

    private static var anyToken: Regex<Substring> { /<[@!][^<>\s]{1,40}>/ }

    /// Markdown-rendered body with mention pills. Highlights mentions of the
    /// current user (and group mentions) more strongly. Built by splitting the
    /// body into plain segments (markdown-rendered) and token segments
    /// (styled pills) — index-safe by construction. Markdown spans crossing a
    /// mention boundary are intentionally not supported.
    /// `scale` is the caller's text zoom (#105): pills carry their own font, so
    /// they have to be told, or they stay put while the prose around them grows.
    static func attributed(
        _ body: String,
        names: [String: String],
        currentUserId: String?,
        scale: CGFloat = 1
    ) -> AttributedString {
        var result = AttributedString()
        var rest = Substring(body)
        while let match = rest.firstMatch(of: anyToken) {
            let token = String(rest[match.range])
            if let pillFor = pill(
                token: token, names: names, currentUserId: currentUserId, scale: scale
            ) {
                if match.range.lowerBound > rest.startIndex {
                    result += markdown(String(rest[rest.startIndex..<match.range.lowerBound]))
                }
                result += pillFor
            } else {
                // not a real mention token: emit up to and including it verbatim
                result += markdown(String(rest[rest.startIndex..<match.range.upperBound]))
            }
            rest = rest[match.range.upperBound...]
        }
        if !rest.isEmpty { result += markdown(String(rest)) }
        return result
    }

    private static func pill(
        token: String, names: [String: String], currentUserId: String?, scale: CGFloat
    ) -> AttributedString? {
        var text: String
        var strong: Bool
        if let m = token.wholeMatch(of: userToken) {
            let id = String(m.1)
            text = "@\(names[id] ?? "someone")"
            strong = id == currentUserId
        } else if let m = token.wholeMatch(of: groupToken) {
            text = "@\(m.1)"
            strong = true
        } else {
            return nil
        }
        var pill = AttributedString(text)
        pill.foregroundColor = strong ? .white : .accentColor
        pill.backgroundColor = strong ? Color.accentColor : Color.accentColor.opacity(0.18)
        pill.font = ZoomedFont.system(.callout, weight: .bold, scale: scale)
        return pill
    }

    private static func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        )) ?? AttributedString(text)
    }
}
