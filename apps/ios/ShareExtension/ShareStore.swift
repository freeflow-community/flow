import Foundation
import UniformTypeIdentifiers

/// Everything the share sheet needs, without the app's SyncEngine: no GRDB
/// cache, no socket, no bootstrap. The extension is a short-lived process that
/// does one POST — it reuses `APIClient`, `Keychain`, `Server` and `ImagePrep`
/// and nothing else (issue #214).
@MainActor
final class ShareStore: ObservableObject {
    enum Phase: Equatable {
        case loading
        case ready
        case sending
        case sent
        case failed(String)
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var workspaces: [Workspace] = []
    @Published private(set) var channels: [Channel] = []
    @Published var workspaceId: String?
    @Published var channelId: String?
    @Published var caption: String = ""

    private(set) var payload: SharePayload?
    private let api = APIClient(baseURL: Server.baseURL)
    /// Display names for DM titles — DMs carry member ids, not a name.
    private var memberNames: [String: String] = [:]

    var canSend: Bool {
        guard case .ready = phase, channelId != nil else { return false }
        if case .image = payload { return true }
        return !caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Channels worth showing: joined, not archived, newest activity irrelevant
    /// — alphabetical is what a picker wants.
    var visibleChannels: [Channel] {
        channels
            .filter { $0.isMember && $0.archivedAt == nil }
            .sorted { title(for: $0).localizedCaseInsensitiveCompare(title(for: $1)) == .orderedAscending }
    }

    func title(for channel: Channel) -> String {
        if let name = channel.name, !name.isEmpty { return "#\(name)" }
        let names = (channel.memberIds ?? []).compactMap { memberNames[$0] }
        return names.isEmpty ? "Direct message" : names.joined(separator: ", ")
    }

    func start(items: [NSExtensionItem]) async {
        guard let token = Keychain.loadToken() else {
            phase = .failed(ShareError.notSignedIn.localizedDescription)
            return
        }
        await api.setToken(token)

        guard let payload = await ShareItemLoader.load(from: items) else {
            phase = .failed(ShareError.nothingToShare.localizedDescription)
            return
        }
        self.payload = payload
        caption = payload.initialCaption

        do {
            let resp: WorkspacesResponse = try await api.get("/v1/me/workspaces")
            workspaces = resp.workspaces
        } catch {
            phase = .failed(message(for: error))
            return
        }

        // Preselect what was shared into last; fall back to the first
        // workspace so a first run is still one tap from sending.
        let remembered = SharedDefaults.lastWorkspaceId
        workspaceId = workspaces.first(where: { $0.id == remembered })?.id ?? workspaces.first?.id
        await loadChannels(preselect: SharedDefaults.lastChannelId)
    }

    func selectWorkspace(_ id: String) async {
        guard id != workspaceId else { return }
        workspaceId = id
        channelId = nil
        await loadChannels(preselect: nil)
    }

    private func loadChannels(preselect: String?) async {
        guard let workspaceId else {
            phase = .failed("No workspaces on this account.")
            return
        }
        phase = .loading
        do {
            let resp: ChannelsResponse = try await api.get("/v1/workspaces/\(workspaceId)/channels")
            channels = resp.channels
            if let members: MembersResponse = try? await api.get("/v1/workspaces/\(workspaceId)/members") {
                memberNames = Dictionary(
                    members.members.map { ($0.userId, $0.displayName) },
                    uniquingKeysWith: { first, _ in first }
                )
            }
            channelId = visibleChannels.first(where: { $0.id == preselect })?.id ?? visibleChannels.first?.id
            phase = .ready
        } catch {
            phase = .failed(message(for: error))
        }
    }

    func send() async {
        guard let channelId, let workspaceId, let payload else { return }
        phase = .sending
        do {
            var fileIds: [String] = []
            var body = caption.trimmingCharacters(in: .whitespacesAndNewlines)
            if case .image(let fileURL) = payload {
                let file = try await uploadFile(workspaceId: workspaceId, fileURL: fileURL)
                fileIds = [file.id]
            }
            // The server requires a non-empty body; an image with no caption
            // posts the same way the composer does.
            if body.isEmpty { body = " " }
            let _: Message = try await api.post(
                "/v1/channels/\(channelId)/messages",
                body: SendMessageBody(
                    clientMsgId: UUID().uuidString.lowercased(),
                    body: body,
                    fileIds: fileIds.isEmpty ? nil : fileIds
                )
            )
            SharedDefaults.lastChannelId = channelId
            SharedDefaults.lastWorkspaceId = workspaceId
            phase = .sent
        } catch {
            phase = .failed(message(for: error))
        }
    }

    /// Same three steps as `SyncEngine.uploadFile`, minus the cache write:
    /// presign → PUT the bytes from disk → complete. The PUT streams, so the
    /// image never lands in this process's memory.
    private func uploadFile(workspaceId: String, fileURL: URL) async throws -> FileAttachment {
        struct PresignBody: Encodable, Sendable {
            let filename: String
            let mimeType: String
            let sizeBytes: Int
        }
        let attrs = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let pres: PresignedUpload = try await api.post(
            "/v1/workspaces/\(workspaceId)/files/presign",
            body: PresignBody(
                filename: fileURL.lastPathComponent,
                mimeType: Self.mimeType(for: fileURL),
                sizeBytes: (attrs[.size] as? Int) ?? 0
            )
        )
        try await api.putRaw(pres.upload.url, headers: pres.upload.headers, fromFile: fileURL)
        return try await api.post("/v1/files/\(pres.file.id)/complete")
    }

    private static func mimeType(for url: URL) -> String {
        UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }

    private func message(for error: Error) -> String {
        if let api = error as? APIError, api.status == 401 {
            return ShareError.notSignedIn.localizedDescription
        }
        return error.localizedDescription
    }
}
