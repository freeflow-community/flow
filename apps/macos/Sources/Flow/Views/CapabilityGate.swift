import SwiftUI

/// Capability gating for the views (#546). A Flow server supports every
/// capability, so on a Flow connection each of these is a no-op and the views
/// render exactly as before. On a provider connection (Slack) a control whose
/// capability is `unavailable` is disabled with the backend's reason as its
/// tooltip, or hidden by the caller via `app.can(...)`; a `limited` one works
/// and says so where it is used (history: on the "Load earlier messages"
/// button) — the same split the web client makes.
extension View {
    /// Disable this control and explain why when the active connection's
    /// backend cannot do `name`. Leaves it untouched otherwise.
    func capability(_ name: CapabilityName) -> some View {
        modifier(CapabilityGate(name: name))
    }
}

private struct CapabilityGate: ViewModifier {
    let name: CapabilityName
    @EnvironmentObject private var app: AppState

    func body(content: Content) -> some View {
        let cap = app.capabilities[name]
        if cap.state == .unavailable {
            content
                .disabled(true)
                .help(cap.reason ?? "Not available for this workspace.")
        } else {
            content
        }
    }
}

/// The provider's limits for one channel, said once at the top of the
/// transcript: a paused event stream, and the way out — open it natively.
/// The history budget and its wait live on the "Load earlier messages"
/// button itself (MessageListView), so they are said in one place.
struct ProviderLimitsBanner: View {
    let channelId: String
    @EnvironmentObject private var app: AppState

    var body: some View {
        Group {
            let lines = lines()
            if !lines.isEmpty {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(lines, id: \.self) { line in
                            Text(line)
                                .flowFont(size: 12)
                                .foregroundStyle(MC.inkSoft)
                        }
                    }
                    Spacer(minLength: 0)
                    if let url = app.providerOpenURL(channelId: channelId) {
                        Link("Open in Slack ↗", destination: url)
                            .flowFont(size: 12, weight: .semibold)
                            .foregroundStyle(MC.accentSoft)
                            .pointingHandCursor()
                            .accessibilityIdentifier("channel.openInProvider")
                    }
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(red: 1, green: 0.98, blue: 0.92))
                .overlay(alignment: .bottom) { Rectangle().fill(MC.hairline).frame(height: 1) }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("channel.providerLimits")
            }
        }
    }

    private func lines() -> [String] {
        app.streamDegraded ? ["Live updates paused; showing cached messages."] : []
    }
}

extension AppState {
    /// When "Load earlier messages" may next ask the provider; nil when there
    /// is no wait. The button stays visible but disabled until then, so the
    /// end of the transcript never reads as the end of the conversation.
    func loadOlderRetryAt(channelId: String) -> Date? {
        guard let limit = historyLimits[channelId], let retry = limit.retryAfter, retry > Date() else { return nil }
        return retry
    }
}
