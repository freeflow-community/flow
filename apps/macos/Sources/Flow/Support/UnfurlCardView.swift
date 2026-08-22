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
    /// Click-to-play (#302): the player only exists once the viewer asks for
    /// it, so a channel full of video links loads nothing from the provider.
    @State private var playing = false

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
                            .flowFont(.caption)
                            .foregroundStyle(MC.muted)
                    }
                }

                if let title = unfurl.title, !title.isEmpty {
                    Text(title)
                        .flowFont(.callout, weight: .semibold)
                        .foregroundStyle(MC.accentSoft)
                        .lineLimit(2)
                }

                if let description = unfurl.description, !description.isEmpty {
                    Text(description)
                        .flowFont(.callout)
                        .foregroundStyle(MC.inkSoft)
                        .lineLimit(3)
                }

                if let meta = metaLine {
                    Text(meta)
                        .flowFont(.caption)
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
                    // Playable links wear a badge and their runtime; tapping
                    // the picture plays rather than opening the browser, which
                    // is what the badge promises.
                    .overlay(alignment: .center) { if unfurl.embed != nil { playBadge } }
                    .overlay(alignment: .bottomTrailing) {
                        if unfurl.embed != nil, let duration = unfurl.durationLabel {
                            Text(duration)
                                .flowFont(.caption, weight: .medium)
                                .monospacedDigit()
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(RoundedRectangle(cornerRadius: 4).fill(.black.opacity(0.75)))
                                .padding(6)
                                .accessibilityIdentifier("unfurl.duration")
                        }
                    }
                    .padding(.top, 3)
                    .contentShape(Rectangle())
                    // Inner gesture wins over the card's open-in-browser tap.
                    .onTapGesture { if unfurl.embed != nil { playing = true } else { open() } }
                    .accessibilityIdentifier(unfurl.embed != nil ? "unfurl.play" : "unfurl.image")
                } else if unfurl.embed != nil {
                    // The image proxy dropped the thumbnail; the card is still
                    // playable, so it still needs somewhere to press.
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.black.opacity(0.8))
                        .frame(width: 320, height: 180)
                        .overlay { playBadge }
                        .padding(.top, 3)
                        .contentShape(Rectangle())
                        .onTapGesture { playing = true }
                        .accessibilityIdentifier("unfurl.play")
                }
            }

            Spacer(minLength: 0)

            if showPin, let onPin {
                Button(action: onPin) {
                    Text("📌").flowFont(.caption)
                }
                .buttonStyle(.plain)
                .help("Pin as artifact")
                .accessibilityIdentifier("unfurl.pin")
            }

            if showRemove {
                Button(action: onRemove) {
                    Text("✕").flowFont(.caption)
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
        #if os(macOS)
        // The card is a link, so it gets the link cursor too (#81).
        .pointingHandCursor()
        #endif
        // The whole card opens the page, like Slack — the title alone is a
        // small target, and the image is the obvious thing to click.
        .onTapGesture { open() }
        .accessibilityIdentifier("msg.unfurl")
        .accessibilityAddTraits(.isLink)
        .sheet(isPresented: $playing) {
            if let embed = unfurl.embed {
                VideoPlayerSheet(embed: embed, title: unfurl.title, target: unfurl.target)
            }
        }
    }

    /// The play affordance itself — a YouTube-shaped lozenge, deliberately big
    /// enough to be an obvious touch target on iOS.
    private var playBadge: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(.black.opacity(0.65))
            .frame(width: 62, height: 42)
            .overlay {
                Image(systemName: "play.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(.white)
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
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
