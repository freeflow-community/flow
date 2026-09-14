import SwiftUI

/// Gives a sidebar row its own hover flag (#399). Kept local to the row rather
/// than held as one "which row is hovered" value on `SidebarView`, so moving the
/// pointer down the list re-renders one row instead of the whole sidebar.
struct SidebarHoverRow<Content: View>: View {
    @ViewBuilder var content: (Bool) -> Content
    @State private var hovering = false

    var body: some View {
        content(hovering)
            .onHover { hovering = $0 }
    }
}

/// The ⋯ button web reveals on sidebar row hover (#399).
///
/// The items come from the caller, which passes the *same* builder its
/// `.contextMenu` uses — right-click and ⋯ are two entry points onto one menu
/// definition, so they cannot drift apart.
///
/// Width is reserved in the row at all times (`SidebarRowMenu.width`) and
/// the button only fades in, so revealing it never nudges the unread badge or
/// re-truncates the channel name — web lets the row reflow, which is the one
/// place this deliberately improves on it.
struct SidebarRowMenu<Items: View>: View {
    /// Room the row leaves for the button, whether or not it is showing.
    /// Non-generic so a row can reserve it without naming an item type.
    static var width: CGFloat { SidebarRowMenuMetrics.width }

    let active: Bool
    let visible: Bool
    let identifier: String
    @ViewBuilder var items: () -> Items

    @State private var hoveringButton = false

    private var tint: Color {
        if active {
            return hoveringButton ? MC.accentDeep : MC.accentDeep.opacity(0.6)
        }
        return .white.opacity(hoveringButton ? 1 : 0.55)
    }

    var body: some View {
        Menu {
            items()
        } label: {
            Image(systemName: "ellipsis")
                .flowFont(size: 12, weight: .bold)
                .foregroundStyle(tint)
                .frame(width: SidebarRowMenuMetrics.width, height: 16)
                .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .onHover { hoveringButton = $0 }
        .opacity(visible ? 1 : 0)
        .allowsHitTesting(visible)
        .accessibilityIdentifier(identifier)
        .accessibilityLabel("Channel options")
    }
}

enum SidebarRowMenuMetrics {
    /// Room a sidebar row leaves at its trailing edge for the ⋯ button.
    static let width: CGFloat = 16
}
