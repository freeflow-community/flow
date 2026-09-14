import SwiftUI

/// Provider capability gating (#546) — the iOS twin of the web client's
/// `useCapability` checks. A Flow server supports everything, so on the
/// default `Capabilities.allSupported` every modifier here is a no-op and the
/// Flow UI is unchanged byte for byte. In a Slack workspace an `unavailable`
/// control is not rendered (web parity: the button does not exist), a
/// `limited` one works and its reason shows once, in the channel's provider
/// strip, rather than on every control.
extension View {
    /// Hide the control when its capability is unavailable.
    @ViewBuilder
    func hiddenUnless(_ name: CapabilityName, in caps: Capabilities) -> some View {
        if caps.canUse(name) { self }
    }

    /// Disable the control and hang the reason off it for VoiceOver — for the
    /// controls that must stay in place (send, load older) so the layout does
    /// not jump.
    @ViewBuilder
    func disabledUnless(_ name: CapabilityName, in caps: Capabilities) -> some View {
        let cap = caps[name]
        if cap.usable {
            self
        } else {
            self.disabled(true).accessibilityHint(cap.reason ?? "Not available for this workspace.")
        }
    }
}

extension Capabilities {
    /// A workspace with any limit or gap: a non-Flow provider.
    var isProviderLimited: Bool { self != .allSupported }
}

enum ProviderLinks {
    /// Where "Open in Slack" goes. The same URL shape the backend's
    /// `openURL(channelId:messageId:)` returns (a Slack workspace's id *is* its
    /// team id — `normalizeWorkspace` in the connector); views cannot reach the
    /// backend, so the shape is repeated here rather than invented.
    static func slackURL(workspaceId: String, channelId: String, messageId: String? = nil) -> URL? {
        var text = "https://app.slack.com/client/\(workspaceId)/\(channelId)"
        if let messageId { text += "/p\(messageId.replacingOccurrences(of: ".", with: ""))" }
        return URL(string: text)
    }
}

/// The one strip a provider workspace gets at the top of a conversation: the
/// live-updates state when the stream is paused, else the history limit's
/// reason. Nothing renders for a Flow workspace.
struct ProviderNoticeView: View {
    let capabilities: Capabilities
    let streamDegraded: Bool
    let openURL: URL?

    private var text: String? {
        if streamDegraded { return "Live updates paused; showing cached messages." }
        let history = capabilities[.history]
        if history.state == .limited { return history.reason }
        return nil
    }

    var body: some View {
        if let text {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(text)
                    .font(.caption)
                    .foregroundStyle(MC.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if let openURL {
                    Link("Open in Slack", destination: openURL)
                        .font(.caption.weight(.semibold))
                        .accessibilityIdentifier("channel.openInSlack")
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(streamDegraded ? Color.orange.opacity(0.14) : Color.yellow.opacity(0.12))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(streamDegraded ? "channel.streamDegraded" : "channel.historyLimited")
        }
    }
}

/// The transcript's top edge in a history-limited channel (#546): the wait,
/// counted down, in place of a "Load earlier" that would only be refused.
struct HistoryLimitFooter: View {
    let limit: AppState.HistoryLimit
    let reason: String?
    let onLoadOlder: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let wait = max(0, Int((limit.retryAfter ?? .distantPast).timeIntervalSince(timeline.date).rounded(.up)))
            VStack(spacing: 4) {
                Text(wait > 0
                     ? "Slack asked Flow to wait \(wait)s before loading older messages."
                     : (reason ?? "Older messages load one page at a time."))
                    .font(.caption)
                    .foregroundStyle(MC.faint)
                    .multilineTextAlignment(.center)
                Button("Load earlier messages", action: onLoadOlder)
                    .font(.callout)
                    .disabled(wait > 0)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .accessibilityIdentifier("msg.historyLimited")
        }
    }
}
