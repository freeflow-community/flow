#if os(iOS)
import UIKit
#else
import AppKit
#endif
import SwiftUI

/// The copy affordance on a rendered code block (#260), shared by the macOS and
/// iOS message lists so the two clients cannot drift.
///
/// Always visible rather than hover-revealed, unlike the message hover menu:
/// iOS has no hover at all, and the complaint behind this was that there was no
/// *visible* way to copy a block — selecting a long token by hand is the thing
/// being fixed, so a hidden button would not fix it. It stays muted until
/// hovered (where hover exists) so it does not compete with the code.
///
/// It carries the block's background behind it because on iOS the code scrolls
/// horizontally underneath: without the fill, a long line would run through the
/// glyph.
///
/// Callers overlay it at `.bottomTrailing`, not the top corner a copy button
/// usually takes: the message row's hover menu is a `.topTrailing` overlay on
/// every client, and its last control is Delete.
struct CodeCopyButton: View {
    let source: String
    @State private var copied = false
    @State private var hovering = false

    var body: some View {
        Button {
            #if os(iOS)
            UIPasteboard.general.string = source
            #else
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(source, forType: .string)
            #endif
            copied = true
            Task {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                copied = false
            }
        } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .flowFont(size: 11, weight: .medium)
                .foregroundStyle(copied ? MC.accent : (hovering ? MC.inkSoft : MC.muted))
                .frame(width: 22, height: 20)
                .background(RoundedRectangle(cornerRadius: 5).fill(MC.codeBg))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(copied ? "Copied" : "Copy code")
        .accessibilityLabel(copied ? "Copied" : "Copy code")
        .accessibilityIdentifier("msg.codeBlockCopy")
    }
}
