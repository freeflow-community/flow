import SwiftUI

#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

// Text zoom (#105). ⌘+ / ⌘− / ⌘0 scale every piece of text in the app.
//
// SwiftUI has no central hook for this. `.scaleEffect` on the root would
// rasterize the text and blur it, and `\.dynamicTypeSize` only moves *semantic*
// fonts (`.callout`, `.caption`) — it does nothing for the ~90 explicit
// `.system(size:)` call sites this UI is built from. So the scale travels down
// as an environment value and every font goes through `flowFont`, which
// multiplies the point size on the way past.
//
// At scale 1.0 `flowFont` hands back the *same* font the call site used before,
// semantic styles included, so the unzoomed app is pixel-identical to what it
// was. Only a zoomed state goes through the derived point sizes.

/// The multiplier applied to every font drawn through `flowFont`.
private struct TextZoomKey: EnvironmentKey {
    static let defaultValue: CGFloat = 1
}

extension EnvironmentValues {
    var textZoom: CGFloat {
        get { self[TextZoomKey.self] }
        set { self[TextZoomKey.self] = newValue }
    }
}

/// App-wide text scale, driven by the View menu's Zoom In / Zoom Out / Actual
/// Size. App-wide rather than per-window: Flow is a one-main-window app, and a
/// per-window scale makes "Actual Size" mean different things in each.
///
/// Persisted (profile-suffixed, like the other prefs) so the setting survives a
/// relaunch — a zoom you have to re-apply every morning is not an
/// accessibility feature.
@MainActor
final class TextZoom: ObservableObject {
    /// Browser-style ladder. 1.0 is the designed size and the ⌘0 reset.
    static let steps: [CGFloat] = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0]
    static let defaultScale: CGFloat = 1.0

    private static var storageKey: String { "textZoomScale" + Profile.suffix }

    private let defaults: UserDefaults

    @Published private(set) var scale: CGFloat

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let saved = defaults.object(forKey: Self.storageKey) as? Double
        scale = Self.nearestStep(saved.map { CGFloat($0) } ?? Self.defaultScale)
    }

    var canZoomIn: Bool { scale < Self.steps[Self.steps.count - 1] }
    var canZoomOut: Bool { scale > Self.steps[0] }
    var isDefault: Bool { scale == Self.defaultScale }

    /// "125%" — for the menu item that reports where you are.
    var label: String { "\(Int((scale * 100).rounded()))%" }

    func zoomIn() { apply(Self.step(from: scale, by: 1)) }
    func zoomOut() { apply(Self.step(from: scale, by: -1)) }
    func reset() { apply(Self.defaultScale) }

    private func apply(_ next: CGFloat) {
        guard next != scale else { return }
        scale = next
        defaults.set(Double(next), forKey: Self.storageKey)
    }

    /// The neighbouring rung, clamped at both ends.
    static func step(from scale: CGFloat, by delta: Int) -> CGFloat {
        let current = steps.firstIndex(of: nearestStep(scale)) ?? steps.firstIndex(of: defaultScale)!
        return steps[min(steps.count - 1, max(0, current + delta))]
    }

    /// Snaps an arbitrary scale onto the ladder, so a value left behind by an
    /// older ladder (or a hand-edited pref) still lands somewhere sane.
    static func nearestStep(_ scale: CGFloat) -> CGFloat {
        steps.min(by: { abs($0 - scale) < abs($1 - scale) }) ?? defaultScale
    }
}

// MARK: - Zoom-aware fonts

/// Builds the `Font` a call site asked for, scaled. Separate from the view
/// modifiers below because a few places need the value itself (a font inside an
/// `AttributedString`, or an AppKit text view's attributes).
enum ZoomedFont {
    static func system(
        size: CGFloat,
        weight: Font.Weight? = nil,
        design: Font.Design? = nil,
        scale: CGFloat
    ) -> Font {
        .system(size: size * scale, weight: weight, design: design)
    }

    static func system(
        _ style: Font.TextStyle,
        weight: Font.Weight? = nil,
        design: Font.Design? = nil,
        scale: CGFloat
    ) -> Font {
        // Unzoomed, hand back the semantic font itself — identical to what the
        // call site drew before this feature existed.
        guard scale != 1 else {
            return .system(style, design: design, weight: weight)
        }
        return .system(
            size: pointSize(style) * scale,
            weight: weight ?? defaultWeight(style),
            design: design
        )
    }

    /// The platform's own point size for a text style, so a zoomed semantic
    /// font lands on the same numbers SwiftUI would have used.
    static func pointSize(_ style: Font.TextStyle) -> CGFloat {
        #if canImport(AppKit)
        return NSFont.preferredFont(forTextStyle: appKitStyle(style)).pointSize
        #elseif canImport(UIKit)
        return UIFont.preferredFont(forTextStyle: uiKitStyle(style)).pointSize
        #else
        return 13
        #endif
    }

    /// `.headline` is semibold by definition — swapping in an explicit point
    /// size would otherwise flatten it to regular. Every other style already
    /// draws at the system default, so leave it unstated.
    static func defaultWeight(_ style: Font.TextStyle) -> Font.Weight? {
        style == .headline ? .semibold : nil
    }

    #if canImport(AppKit)
    private static func appKitStyle(_ style: Font.TextStyle) -> NSFont.TextStyle {
        switch style {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
    }
    #elseif canImport(UIKit)
    private static func uiKitStyle(_ style: Font.TextStyle) -> UIFont.TextStyle {
        switch style {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
    }
    #endif
}

private struct ZoomedSizeFont: ViewModifier {
    let size: CGFloat
    let weight: Font.Weight?
    let design: Font.Design?
    @Environment(\.textZoom) private var zoom

    func body(content: Content) -> some View {
        content.font(ZoomedFont.system(size: size, weight: weight, design: design, scale: zoom))
    }
}

private struct ZoomedStyleFont: ViewModifier {
    let style: Font.TextStyle
    let weight: Font.Weight?
    let design: Font.Design?
    @Environment(\.textZoom) private var zoom

    func body(content: Content) -> some View {
        content.font(ZoomedFont.system(style, weight: weight, design: design, scale: zoom))
    }
}

extension View {
    /// `.font(.system(size:weight:design:))`, scaled by the current text zoom.
    func flowFont(
        size: CGFloat,
        weight: Font.Weight? = nil,
        design: Font.Design? = nil
    ) -> some View {
        modifier(ZoomedSizeFont(size: size, weight: weight, design: design))
    }

    /// `.font(.callout)` and friends, scaled by the current text zoom.
    func flowFont(
        _ style: Font.TextStyle,
        weight: Font.Weight? = nil,
        design: Font.Design? = nil
    ) -> some View {
        modifier(ZoomedStyleFont(style: style, weight: weight, design: design))
    }
}
