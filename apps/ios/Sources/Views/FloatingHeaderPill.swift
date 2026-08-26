import SwiftUI

/// The floating header (#298): one rounded pill carrying a screen's title, its
/// subtitle and its two controls, laid over content that runs all the way to
/// the top of the viewport. It replaces the system navigation bar on the
/// screens that adopt it — those call `.toolbar(.hidden, for: .navigationBar)`
/// and hand their bar's controls to this view instead.
///
/// Put it in a `ZStack(alignment: .top)` *after* the content, and let only the
/// content ignore the top safe area. The pill then lands just under the status
/// bar with no inset arithmetic:
///
/// ```swift
/// ZStack(alignment: .top) {
///     chatStack.ignoresSafeArea(.container, edges: .top)
///     FloatingHeaderPill(…)
/// }
/// ```
struct FloatingHeaderPill<Trailing: View>: View {
    let title: String
    var subtitle: String?
    let leadingSystemImage: String
    let leadingAction: () -> Void
    var leadingAccessibilityIdentifier: String
    var leadingAccessibilityLabel: String
    /// Identifier for the subtitle line, when a screen's tests look for it.
    var subtitleAccessibilityIdentifier: String?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        // Title and subtitle stack *inside* the control row. Stacking the other
        // way round — controls in one row, subtitle beneath — centres the two
        // controls on the title line, so any screen with a subtitle pushes them
        // visibly above the pill's centre.
        HStack(spacing: 8) {
            PillGlyphButton(systemImage: leadingSystemImage, action: leadingAction)
                .accessibilityIdentifier(leadingAccessibilityIdentifier)
                .accessibilityLabel(leadingAccessibilityLabel)
            Spacer(minLength: 2)
            // Identifiers go on the leaves, never on this VStack or the pill
            // itself: an identifier on a container hides its children from the
            // accessibility tree, which would take `nav.menu` and
            // `channel.menu` out of reach of every UI test that taps them.
            VStack(spacing: 1) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .accessibilityIdentifier("header.title")
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(.white.opacity(0.72))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .padding(.horizontal, 8)
                        .accessibilityIdentifier(subtitleAccessibilityIdentifier ?? "header.subtitle")
                }
            }
            Spacer(minLength: 2)
            trailing()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(
            Capsule(style: .continuous)
                .fill(MC.sidebarGradient)
                .shadow(color: .black.opacity(0.28), radius: 12, x: 0, y: 5)
        )
        .padding(.horizontal, 18)
        .padding(.top, FloatingHeaderMetrics.topPadding)
    }
}

/// Shared numbers. `FloatingHeaderPill` is generic over its trailing view, and
/// a generic type cannot hold static stored properties — hence the enum.
enum FloatingHeaderMetrics {
    /// The gap between the status bar and the pill.
    /// `fadesAboveFloatingHeader` needs the same number.
    static let topPadding: CGFloat = 2
}

/// The strip the pill floats below: the status bar, plus the pill's own top
/// padding. Read from the window rather than through a `GeometryReader`
/// preference — a preference published from the pill and consumed by its
/// sibling settles at the default (0) on first layout and never updates, so
/// the fade never appeared. The app is portrait-only, so this value is fixed
/// for the life of the screen.
@MainActor var floatingHeaderTopInset: CGFloat {
    let window = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .first { $0.activationState == .foregroundActive }?
        .keyWindow
    // 47pt covers every Dynamic Island phone; the fallback only matters for
    // the frame or two before a window exists.
    return (window?.safeAreaInsets.top ?? 47) + FloatingHeaderMetrics.topPadding
}

extension View {
    /// Fades this content out over the strip above the pill, so a transcript
    /// running to the top of the viewport stops competing with the status bar
    /// clock (#298).
    ///
    /// Apply to the content *after* `.ignoresSafeArea(.container, edges: .top)`,
    /// so the mask and the content share an origin at the top of the screen.
    /// Pass `floatingHeaderTopInset`.
    ///
    /// The gradient holds at fully clear for the first 60% of that strip —
    /// the part the clock and the status icons occupy — and only ramps up in
    /// the gap just above the pill. A plain top-to-bottom ramp would still
    /// leave text at about three quarters opacity behind the clock, which is
    /// the competition this is meant to remove.
    func fadesAboveFloatingHeader(_ pillTop: CGFloat) -> some View {
        mask(
            VStack(spacing: 0) {
                LinearGradient(
                    stops: [
                        .init(color: .black.opacity(0), location: 0),
                        .init(color: .black.opacity(0), location: 0.6),
                        .init(color: .black, location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: max(pillTop, 0))
                Rectangle().fill(.black)
            }
            .ignoresSafeArea()
        )
    }
}

/// A pill control: a white glyph on a translucent disc, so it reads against the
/// gradient without competing with the title.
struct PillGlyphButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            PillGlyph(systemImage: systemImage)
        }
        .buttonStyle(.plain)
    }
}

/// The same disc without the button, for a `Menu` — which supplies its own tap
/// handling and only wants a label.
struct PillGlyph: View {
    let systemImage: String

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 32, height: 32)
            .background(Circle().fill(.white.opacity(0.2)))
    }
}

/// A blank the size of a `PillGlyph`, so a pill with only one control keeps its
/// title centred instead of letting it drift right.
struct PillGlyphSpacer: View {
    var body: some View { Color.clear.frame(width: 32, height: 32) }
}

extension FloatingHeaderPill where Trailing == PillGlyphSpacer {
    /// A pill with no trailing control. The slot is kept, invisibly, so the
    /// title stays centred on the pill rather than drifting right.
    init(
        title: String,
        subtitle: String? = nil,
        leadingSystemImage: String,
        leadingAccessibilityIdentifier: String,
        leadingAccessibilityLabel: String,
        leadingAction: @escaping () -> Void
    ) {
        self.init(
            title: title,
            subtitle: subtitle,
            leadingSystemImage: leadingSystemImage,
            leadingAction: leadingAction,
            leadingAccessibilityIdentifier: leadingAccessibilityIdentifier,
            leadingAccessibilityLabel: leadingAccessibilityLabel,
            trailing: { PillGlyphSpacer() }
        )
    }
}
