import Foundation

/// What a `huddle.invite` event means *for this device* (#436).
///
/// One event type carries the whole ring lifecycle to everyone involved —
/// caller and callees, every device of each — so the interesting logic is the
/// reading, not the sending. Pure and separate from AppState because it is the
/// part with real cases in it: the same event has to raise a card on one
/// phone, take it down on that person's laptop *with an explanation*, and tell
/// the caller "still ringing". Mirrors packages/web/src/lib/huddleRing.ts.
enum RingEffect: Equatable {
    /// Not about us at all.
    case ignore
    /// Raise (or keep) the incoming-call card.
    case ring(HuddleInvite)
    /// Take the card down — this device answered, declined, or the call ended.
    case dismiss
    /// Take the card down and say why: another of this user's devices answered.
    case answeredElsewhere
    /// We are the caller: our ring is still live, or it has resolved.
    case outgoing(HuddleInvite?, unavailable: [String])
}

func ringEffect(
    _ invite: HuddleInvite,
    selfId: String,
    mySessionId: String?,
    answeredBySessionId: String? = nil,
    unavailable: [String]? = nil
) -> RingEffect {
    if invite.startedBy == selfId {
        return .outgoing(invite.status == .ringing ? invite : nil, unavailable: unavailable ?? [])
    }
    guard let mine = invite.targets.first(where: { $0.userId == selfId }) else { return .ignore }
    // Still ringing *for us*. In a group DM the invite flips to `active` on the
    // first accept while everyone else keeps ringing — late join is allowed —
    // so the card keys off our own row, not the call's.
    if mine.status == .ringing, invite.status == .ringing || invite.status == .active {
        return .ring(invite)
    }
    // Accepted, but not by the socket reading this: a sibling device answered.
    if mine.status == .accepted, answeredBySessionId != mySessionId {
        return .answeredElsewhere
    }
    return .dismiss
}
