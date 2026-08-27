import AppKit
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
    /// at all when there isn't one — an empty bubble is worse than none (#392).
    ///
    /// Deliberately *not* SwiftUI's `.help(_:)`. In a lazy list of rows `.help`
    /// does not give each row its own AppKit tooltip rect, so NSToolTipManager
    /// arms once when the pointer enters the list and never re-evaluates the
    /// string as the pointer crosses into another row: the first row hovered
    /// shows its topic, every row after it shows that same stale topic and then
    /// nothing at all until you leave the window and come back (#398). Owning a
    /// real NSView per row restores the per-row enter/exit AppKit needs.
    @ViewBuilder
    func topicHelp(_ topic: String?) -> some View {
        if let text = TopicTooltip.text(topic) {
            overlay(ToolTipOverlay(text: text))
        } else {
            self
        }
    }
}

/// An NSView whose only job is to own a `toolTip` covering the view it overlays.
private struct ToolTipOverlay: NSViewRepresentable {
    let text: String

    func makeNSView(context: Context) -> NSView {
        let view = PassthroughToolTipView()
        view.toolTip = text
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        guard view.toolTip != text else { return }
        view.toolTip = text
    }
}

/// Invisible to the mouse: tooltips are driven by AppKit's tooltip rects, not by
/// hit-testing, so returning nil keeps clicks, right-click menus and the row's
/// own controls working while the tooltip still tracks the row.
private final class PassthroughToolTipView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
