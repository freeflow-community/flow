import SwiftUI

/// The channel topic tooltip (#392) — hovering a channel name says what the
/// channel is for without opening it.
///
/// macOS gets the native tooltip rather than a drawn bubble: the system delay,
/// the system look, and NSToolTip's own wrapping for a long topic, which is the
/// platform equivalent of the web client's 300pt wrap.
enum TopicTooltip {
    /// The text to show, or nil for "no tooltip at all". A channel with no
    /// topic — and one whose topic is blank, which the server stores as null
    /// but an older row may not — gets no tooltip, not an empty one.
    static func text(_ raw: String?) -> String? {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

extension View {
    /// Native tooltip carrying the channel's topic, and *no* tooltip machinery
    /// at all when there isn't one — `.help("")` still arms a tooltip, and an
    /// empty bubble is worse than none (#392).
    @ViewBuilder
    func topicHelp(_ topic: String?) -> some View {
        if let text = TopicTooltip.text(topic) {
            self.help(text)
        } else {
            self
        }
    }
}
