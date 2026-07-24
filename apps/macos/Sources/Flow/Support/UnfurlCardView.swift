import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Phase 11 link preview card — shared by the macOS and iOS message lists so
/// the two can't drift (same arrangement as MarkdownTableView).
///
/// Every field except the URL is optional, so each block is independently
/// conditional and a sparse card (title only) still reads as deliberate.
/// Images and favicons are served from our own auth'd endpoint — the server
/// proxies them precisely so no client hotlinks a third-party origin — which
/// is why they load through `AuthImage` rather than a raw remote URL.
struct UnfurlCardView: View {
    let unfurl: Unfurl
    /// Only the message's author may remove its cards (§10).
    let canRemove: Bool
    let onRemove: () -> Void
    /// Pin this link as a co-browsing artifact (link artifacts). Nil where artifacts
    /// aren't available (iOS has no artifact panel yet), which hides the button.
    var onPin: (() -> Void)? = nil

    @State private var hovering = false

    /// macOS reveals the remove affordance on hover; touch has no hover, so
    /// iOS shows it whenever the viewer is allowed to use it.
    private var showRemove: Bool {
        #if os(macOS)
        return canRemove && hovering
        #else
        return canRemove
        #endif
    }

    /// Same reveal rule as remove, gated on a pin handler being provided.
    private var showPin: Bool {
        guard onPin != nil else { return false }
        #if os(macOS)
        return hovering
        #else
        return true
        #endif
    }

    private var siteLabel: String {
        let name = unfurl.siteName?.trimmingCharacters(in: .whitespaces) ?? ""
        return name.isEmpty ? unfurl.hostLabel : name
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            // accent rail
            RoundedRectangle(cornerRadius: 1.5)
                .fill(MC.accent.opacity(0.35))
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 3) {
                if !siteLabel.isEmpty {
                    HStack(spacing: 5) {
                        if let favicon = unfurl.faviconUrl {
                            AuthImage(path: favicon) { Color.clear }
                                .frame(width: 14, height: 14)
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                        }
                        Text(siteLabel)
                            .font(.caption)
                            .foregroundStyle(MC.muted)
                    }
                }

                if let title = unfurl.title, !title.isEmpty {
                    Text(title)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(MC.accentSoft)
                        .lineLimit(2)
                }

                if let description = unfurl.description, !description.isEmpty {
                    Text(description)
                        .font(.callout)
                        .foregroundStyle(MC.inkSoft)
                        .lineLimit(3)
                }

                if let meta = metaLine {
                    Text(meta)
                        .font(.caption)
                        .foregroundStyle(MC.faint)
                }

                if let image = unfurl.image {
                    // Size the box exactly from the server's dimensions rather
                    // than letting a flexible frame expand: `maxWidth` takes
                    // the whole offer, so a portrait preview would sit
                    // letterboxed inside a wide bordered box.
                    let box = imageBox(image)
                    AuthImage(path: unfurl.isLargeImage ? image.url : (image.thumbUrl ?? image.url)) {
                        RoundedRectangle(cornerRadius: 6).fill(MC.daypill)
                    }
                    .frame(width: box.width, height: box.height)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(MC.hairline))
                    .padding(.top, 3)
                }
            }

            Spacer(minLength: 0)

            if showPin, let onPin {
                Button(action: onPin) {
                    Text("📌").font(.caption)
                }
                .buttonStyle(.plain)
                .help("Pin as artifact")
                .accessibilityIdentifier("unfurl.pin")
            }

            if showRemove {
                Button(action: onRemove) {
                    Text("✕").font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(MC.faint)
                .help("Remove this preview")
                .accessibilityIdentifier("unfurl.remove")
            }
        }
        .padding(.vertical, 7)
        .padding(.trailing, 8)
        .padding(.leading, 0)
        .frame(maxWidth: 520, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(MC.base.opacity(0.6)))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        // The whole card opens the page, like Slack — the title alone is a
        // small target, and the image is the obvious thing to click.
        .onTapGesture { open() }
        .accessibilityIdentifier("msg.unfurl")
        .accessibilityAddTraits(.isLink)
    }

    /// Author · date, when either is present.
    private var metaLine: String? {
        let author = unfurl.author?.trimmingCharacters(in: .whitespaces) ?? ""
        let date = formattedDate(unfurl.publishedAt)
        let parts = [author, date].filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func aspect(_ image: Unfurl.Image) -> CGFloat {
        guard let w = image.width, let h = image.height, w > 0, h > 0 else { return 1 }
        return CGFloat(w) / CGFloat(h)
    }

    /// The exact display box: the largest size preserving the image's aspect
    /// ratio that fits the layout's bounds. Square when dimensions are absent.
    private func imageBox(_ image: Unfurl.Image) -> CGSize {
        let maxW: CGFloat = unfurl.isLargeImage ? 360 : 80
        let maxH: CGFloat = unfurl.isLargeImage ? 320 : 80
        let ratio = aspect(image)
        let width = min(maxW, maxH * ratio)
        return CGSize(width: width, height: width / ratio)
    }

    private func formattedDate(_ iso: String?) -> String {
        guard let iso, let date = ISO8601DateFormatter().date(from: iso) else { return "" }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    private func open() {
        guard let url = URL(string: unfurl.target) else { return }
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }
}
