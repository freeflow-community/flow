import AppKit
import SwiftUI

/// View > Zoom In / Zoom Out / Actual Size (#105).
///
/// A keyboard shortcut with no menu item is undiscoverable on macOS — and
/// unreachable for anyone driving the app from the menu bar or a
/// switch-control setup — so the commands live in the View menu where every
/// other Mac app puts them.
struct TextZoomCommands: View {
    @ObservedObject var zoom: TextZoom

    var body: some View {
        Button("Zoom In") { zoom.zoomIn() }
            .keyboardShortcut("+", modifiers: .command)
            .disabled(!zoom.canZoomIn)

        Button("Zoom Out") { zoom.zoomOut() }
            .keyboardShortcut("-", modifiers: .command)
            .disabled(!zoom.canZoomOut)

        // Reports where you are as well as offering the way back: a zoom with
        // no route to 100% is a trap the ticket didn't ask us not to build.
        Button(zoom.isDefault ? "Actual Size" : "Actual Size (\(zoom.label))") { zoom.reset() }
            .keyboardShortcut("0", modifiers: .command)
            .disabled(zoom.isDefault)
    }
}

/// ⌘= as a second way to zoom in.
///
/// The menu item advertises ⌘+, which is what people call the shortcut and
/// what every Mac app displays — but "+" is a shifted key, so AppKit's menu
/// matching only fires on ⌘⇧=. Nobody presses shift. Apple's own apps solve
/// this by claiming the unshifted key separately; a local key monitor is that,
/// without a duplicate row in the menu.
@MainActor
enum TextZoomShortcuts {
    private static var monitor: Any?

    static func install(_ zoom: TextZoom) {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            // Command and nothing that changes what the key means. Testing for
            // `== .command` looks tidier and is wrong: caps lock (and the
            // keypad flag on a keypad "=") ride along in this mask, and the
            // shortcut would silently stop working.
            guard modifiers.contains(.command),
                  modifiers.isDisjoint(with: [.shift, .control, .option]),
                  event.charactersIgnoringModifiers == "="
            else { return event }
            zoom.zoomIn()
            return nil // consumed
        }
    }
}
