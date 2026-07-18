import SwiftUI

/// Workspace sidebar color presets (phase 3.5 ruling 3).
///
/// MIRROR of packages/shared/src/theme.ts SIDEBAR_COLORS — keep the ids,
/// names, and hex values aligned with that file; the server validates ids
/// against the same list. Every gradient is tuned dark enough that the
/// design-3a white sidebar text stays legible.
struct SidebarPalette: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    /// gradient top
    let top: Color
    /// gradient bottom
    let bottom: Color
    /// workspace-rail shade (slightly darker)
    let rail: Color

    var gradient: LinearGradient {
        LinearGradient(colors: [top, bottom], startPoint: .top, endPoint: .bottom)
    }

    static let all: [SidebarPalette] = [
        // design 3a default (== MC.sideTop/sideBot/rail)
        SidebarPalette(
            id: "violet", name: "Violet",
            top: Color(hex: 0x7D3AB7), bottom: Color(hex: 0x5A2FB0), rail: Color(hex: 0x5528A9)
        ),
        SidebarPalette(
            id: "indigo", name: "Indigo",
            top: Color(hex: 0x4A50C0), bottom: Color(hex: 0x343BA8), rail: Color(hex: 0x2E339B)
        ),
        SidebarPalette(
            id: "ocean", name: "Ocean",
            top: Color(hex: 0x1E6FA8), bottom: Color(hex: 0x155A8C), rail: Color(hex: 0x124E7B)
        ),
        SidebarPalette(
            id: "forest", name: "Forest",
            top: Color(hex: 0x2F7D5A), bottom: Color(hex: 0x20634A), rail: Color(hex: 0x1B5740)
        ),
        SidebarPalette(
            id: "ember", name: "Ember",
            top: Color(hex: 0xB0532B), bottom: Color(hex: 0x93401F), rail: Color(hex: 0x83381A)
        ),
        SidebarPalette(
            id: "plum", name: "Plum",
            top: Color(hex: 0x8C2F66), bottom: Color(hex: 0x6F2350), rail: Color(hex: 0x612046)
        ),
        SidebarPalette(
            id: "slate", name: "Slate",
            top: Color(hex: 0x4A5568), bottom: Color(hex: 0x374151), rail: Color(hex: 0x303845)
        ),
        SidebarPalette(
            id: "midnight", name: "Midnight",
            top: Color(hex: 0x23305E), bottom: Color(hex: 0x1A2547), rail: Color(hex: 0x16203E)
        ),
    ]

    /// Palette for a workspace's stored preset id; unknown/nil → violet default.
    static func palette(for id: String?) -> SidebarPalette {
        all.first { $0.id == id } ?? all[0]
    }
}
