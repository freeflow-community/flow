import SwiftUI

// Design 3a "Quiet, in violet" tokens (design_handoff_chat_workspace/README.md).
// oklch values converted to sRGB hex.
enum MC {
    static let rail = Color(hex: 0x5528A9) // oklch(0.42 0.19 292)
    static let sideTop = Color(hex: 0x7D3AB7) // oklch(0.5 0.19 305)
    static let sideBot = Color(hex: 0x5A2FB0) // oklch(0.44 0.19 292)
    static let base = Color(hex: 0xFBFAF8)
    static let ink = Color(hex: 0x39342F)
    static let inkSoft = Color(hex: 0x635D56)
    static let muted = Color(hex: 0xA49D94)
    static let faint = Color(hex: 0xB7B0A6)
    static let hairline = Color(hex: 0xE7E3DB)
    static let hairline2 = Color(hex: 0xDDD8CF)
    static let hairline3 = Color(hex: 0xEEE7DC)
    static let daypill = Color(hex: 0xF0EDE7)
    static let codeBg = Color(hex: 0xF4F2EE) // warm code-block background
    static let accent = Color(hex: 0x6B30AF) // oklch(0.46 0.19 300)
    static let accentDeep = Color(hex: 0x6529A9)
    static let accentSoft = Color(hex: 0x52339B) // oklch(0.42 0.16 292)
    static let send = Color(hex: 0x7D3AB7)
    static let online = Color(hex: 0x5EF0A8)
    static let unread = Color(hex: 0xFF5C8A)
    static let danger = Color(hex: 0xC4342E) // failed-send / error affordances

    static let sidebarGradient = LinearGradient(
        colors: [sideTop, sideBot], startPoint: .top, endPoint: .bottom
    )

    /// Design 3a avatar palette (bg, fg), extended with two matching pairs.
    static let avatarPalette: [(Color, Color)] = [
        (Color(hex: 0xE9C8B0), Color(hex: 0x7A4D2B)),
        (Color(hex: 0xBCD0E9), Color(hex: 0x2B527A)),
        (Color(hex: 0xCBE3C9), Color(hex: 0x3A6B3A)),
        (Color(hex: 0xFFB547), Color(hex: 0x5A3A00)),
        (Color(hex: 0xE3C9E0), Color(hex: 0x6B2B62)),
        (Color(hex: 0xF0E0A8), Color(hex: 0x6E5A14)),
    ]

    static func avatarColors(for userId: String) -> (Color, Color) {
        var hash = 0
        for scalar in userId.unicodeScalars {
            hash = (hash &* 31 &+ Int(scalar.value)) & 0x7fffffff
        }
        return avatarPalette[hash % avatarPalette.count]
    }

    /// Canned statuses (design 3a status picker). `suppresses` marks the
    /// DND-family entries that pause alerts server-side (phase 10) — same
    /// list and flags as the web client's STATUS_OPTIONS.
    static let statusOptions: [(emoji: String, text: String, suppresses: Bool)] = [
        ("🎧", "Focusing", true),
        ("🗓️", "In a meeting", true),
        ("🌴", "Vacationing", false),
        ("🏠", "Working remotely", false),
        ("🤒", "Out sick", false),
        ("🍽️", "At lunch", true),
        ("💬", "Available", false),
        ("🚫", "Do not disturb", true),
    ]
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// Initials-on-color avatar chip with real-image fallback (design 3a).
struct AvatarChip: View {
    let userId: String
    let name: String
    let avatarPath: String?
    var size: CGFloat = 38
    var radius: CGFloat = 11

    var body: some View {
        Group {
            if let avatarPath {
                AuthImage(path: avatarPath) { fallback }
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: radius))
            } else {
                fallback
            }
        }
    }

    private var fallback: some View {
        let (bg, fg) = MC.avatarColors(for: userId)
        return RoundedRectangle(cornerRadius: radius)
            .fill(bg)
            .frame(width: size, height: size)
            .overlay(
                Text(initials)
                    .font(.system(size: size * 0.37, weight: .heavy))
                    .foregroundStyle(fg)
            )
    }

    private var initials: String {
        let parts = name.split(separator: " ")
        let chars = parts.prefix(2).compactMap(\.first)
        return chars.isEmpty ? "?" : String(chars).uppercased()
    }
}
