import SwiftUI

extension View {
    /// Declares a navigation-bar toolbar whose buttons sit directly on the bar
    /// (#298).
    ///
    /// From iOS 26 every bar button gets a Liquid Glass capsule behind it —
    /// near-white (`#FFFFFE`), with a soft shadow that spreads to the edges of
    /// the screen. Against `MC.base` (`#FBFAF8`) that reads as a pale band
    /// across the top: two white discs and the grey halo between them, which is
    /// the "header banner" that does not match the panel below it. The bar's
    /// own background was never the problem — it measures `MC.base` already,
    /// which is why `.toolbarBackground(MC.base, for: .navigationBar)` changes
    /// nothing here.
    ///
    /// Hiding the shared background leaves the bare glyph, which is the shape
    /// the macOS header has always had (`ChannelView.swift`). Pre-26 systems
    /// never drew the capsule, so they take the plain toolbar unchanged.
    @ViewBuilder
    func flowBarToolbar<C: ToolbarContent>(@ToolbarContentBuilder _ content: () -> C) -> some View {
        if #available(iOS 26.0, *) {
            toolbar { content().sharedBackgroundVisibility(.hidden) }
        } else {
            toolbar(content: content)
        }
    }
}
