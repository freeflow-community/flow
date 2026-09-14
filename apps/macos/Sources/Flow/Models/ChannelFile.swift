import Foundation

// Channel Files list (#347 web/macOS, #348 iOS): one row of
// GET /v1/channels/:id/files — a file attached to a live message in the
// channel. Shared by both apps, so it lives here rather than in either
// target's Views.
//
// The wire shape is flat, but every existing preview/download path in the apps
// speaks `FileAttachment`, so a row decodes into one of those plus the bits the
// panel adds (who shared it, when, and in which message). Nothing has to be
// re-implemented to show a row in the lightbox or save it to Downloads.

struct ChannelFile: Codable, Sendable, Equatable, Identifiable {
    var file: FileAttachment
    var uploaderName: String
    /// When it was shared — the message's timestamp, not the upload's.
    var sharedAt: String
    var messageId: String

    /// A file shared twice appears once per message, so the row identity is the
    /// pair, not the file id.
    var id: String { "\(messageId)-\(file.id)" }

    enum CodingKeys: String, CodingKey {
        case id, name, mimeType, sizeBytes, width, height, hasThumb
        case userId, uploaderName, createdAt, messageId
    }

    init(file: FileAttachment, uploaderName: String, sharedAt: String, messageId: String) {
        self.file = file
        self.uploaderName = uploaderName
        self.sharedAt = sharedAt
        self.messageId = messageId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        file = FileAttachment(
            id: try c.decode(String.self, forKey: .id),
            workspaceId: nil,
            userId: try c.decodeIfPresent(String.self, forKey: .userId),
            name: try c.decode(String.self, forKey: .name),
            mimeType: try c.decode(String.self, forKey: .mimeType),
            sizeBytes: try c.decodeIfPresent(Int.self, forKey: .sizeBytes) ?? 0,
            width: try c.decodeIfPresent(Int.self, forKey: .width),
            height: try c.decodeIfPresent(Int.self, forKey: .height),
            hasThumb: try c.decodeIfPresent(Bool.self, forKey: .hasThumb) ?? false,
            createdAt: createdAt
        )
        uploaderName = try c.decodeIfPresent(String.self, forKey: .uploaderName) ?? ""
        sharedAt = createdAt ?? ""
        messageId = try c.decode(String.self, forKey: .messageId)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(file.id, forKey: .id)
        try c.encode(file.name, forKey: .name)
        try c.encode(file.mimeType, forKey: .mimeType)
        try c.encode(file.sizeBytes, forKey: .sizeBytes)
        try c.encodeIfPresent(file.width, forKey: .width)
        try c.encodeIfPresent(file.height, forKey: .height)
        try c.encode(file.hasThumb, forKey: .hasThumb)
        try c.encodeIfPresent(file.userId, forKey: .userId)
        try c.encode(uploaderName, forKey: .uploaderName)
        try c.encode(sharedAt, forKey: .createdAt)
        try c.encode(messageId, forKey: .messageId)
    }

    /// "Aug 24", or "Aug 24, 2025" once the year stops being obvious.
    var dateLabel: String {
        guard let date = ISO8601.parse(sharedAt) else { return "" }
        let f = DateFormatter()
        f.dateFormat = Calendar.current.component(.year, from: date)
            == Calendar.current.component(.year, from: Date()) ? "MMM d" : "MMM d, yyyy"
        return f.string(from: date)
    }

    /// The extension shown on the type block for non-previewable rows.
    var typeLabel: String {
        let e = (file.name as NSString).pathExtension.lowercased()
        return e.isEmpty || e.count > 4 ? "file" : e
    }
}

/// The four sort orders the panel offers, in the order the links appear.
enum ChannelFileSort: String, CaseIterable, Sendable {
    case newest, oldest, name, size

    var label: String {
        switch self {
        case .newest: return "Newest"
        case .oldest: return "Oldest"
        case .name: return "Name"
        case .size: return "Size"
        }
    }
}

/// One page of GET /v1/channels/:id/files. `nextCursor` is opaque — hand it
/// straight back as `before`; nil means the list is exhausted.
struct ChannelFilePage: Codable, Sendable, Equatable {
    var files: [ChannelFile]
    var total: Int
    var nextCursor: String?
}
