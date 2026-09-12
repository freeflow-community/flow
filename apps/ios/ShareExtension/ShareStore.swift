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
    /// Size of the file being shared, 0 for a text share. Shown in the preview
    /// and used for the pre-flight limit check.
    private(set) var fileSize: Int64 = 0
    private(set) var maxFileBytes: Int64 = ShareStore.fallbackMaxFileBytes
    private var api: APIClient!
    /// Set for a Slack connection (#546): the send goes through the connector
    /// via the same adapter the app uses, and `api` is never touched.
    private var backend: WorkspaceBackend?
    @Published private(set) var connections: [ServerConnection] = []
    @Published private(set) var connectionId: String?
    private var registry: ConnectionRegistry?
    var connection: ServerConnection? { connections.first { $0.connectionId == connectionId } }
    var isSlack: Bool { backend != nil }
    var serverLabel: String {
        guard let connection else { return "" }
        return connection.provider == .slack ? "Slack · \(connection.label)" : connection.canonicalOrigin?.label ?? ""
    }
    /// The picker row for a connection: a Flow server by its origin, a Slack
    /// team by its name with a Slack label.
    func pickerLabel(for connection: ServerConnection) -> String {
        connection.provider == .slack ? "\(connection.label) (Slack)" : connection.canonicalOrigin?.label ?? connection.origin
    }
    /// A file can't go to Slack from here. Shown under the attachment so the
    /// user can pick a Flow server instead of hitting a dead end.
    var attachmentRefusal: String? {
        isSlack && payload?.fileURL != nil ? ShareError.slackFilesMessage : nil
    }

    func selectConnection(_ id: String) async {
        guard case .ready = phase else { return }
        guard id != connectionId else { return }
        phase = .loading
        guard await configureConnection(id) else { return }
        do {
            if let backend {
                workspaces = try await backend.listWorkspaces()
            } else {
                maxFileBytes = await uploadLimit()
                let response: WorkspacesResponse = try await api.get("/v1/me/workspaces")
                workspaces = response.workspaces
            }
            workspaceId = workspaces.first?.id
            await loadChannels(preselect: nil)
        } catch { phase = .failed(message(for: error)) }
    }

    private func configureConnection(_ id: String) async -> Bool {
        guard let connection = registry?.connection(id), let session = registry?.session(id),
              session.status == .authenticated, let origin = connection.canonicalOrigin,
              let token = Keychain.loadToken(account: session.credentialRef) else {
            phase = .failed(ShareError.notSignedIn.localizedDescription); return false
        }
        connectionId = id
        if connection.provider == .slack {
            // Same construction as ConnectionRuntime.makeBackend in the app
            // (not compiled into the extension): the credential is read from
            // the Keychain slot on each use, never copied.
            let account = session.credentialRef
            // providerIdentity is `["slack", enterpriseId, teamId, userId]`.
            let parts = (try? JSONSerialization.jsonObject(with: Data(connection.providerIdentity.utf8))) as? [Any] ?? []
            backend = SlackBackend(
                connectionId: connection.connectionId, origin: origin.url,
                teamId: parts.count > 2 ? parts[2] as? String ?? "" : "",
                userId: parts.count > 3 ? parts[3] as? String ?? "" : "",
                label: connection.label, granted: connection.capabilities,
                credential: { Keychain.loadToken(account: account) }, autoPoll: false
            )
            api = nil
        } else {
            backend = nil
            api = APIClient(baseURL: origin.url)
            let selectedAPI = api!
            await selectedAPI.setToken(token)
        }
        channelId = nil; workspaceId = nil; channels = []; workspaces = []; memberNames = [:]
        return true
    }
    /// Display names for DM titles — DMs carry member ids, not a name.
    private var memberNames: [String: String] = [:]

    /// What the server ships with (`FLOW_MAX_FILE_MB ?? 500`). Only used when
    /// `/v1/config` cannot be reached or predates the field — the real limit
    /// comes from the server, so a deployment that raises or lowers it does not
    /// leave the extension enforcing a different number (issue #219).
    static let fallbackMaxFileBytes: Int64 = 500 * 1024 * 1024

    var canSend: Bool {
        guard case .ready = phase, channelId != nil else { return false }
        if attachmentRefusal != nil { return false }
        if payload?.fileURL != nil { return fileSize <= maxFileBytes }
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
        guard let defaults = UserDefaults(suiteName: SharedDefaults.appGroup),
              let registry = ConnectionStore.load(from: defaults) else {
            phase = .failed(ShareError.notSignedIn.localizedDescription); return
        }
        self.registry = registry
        connections = registry.connections.filter { registry.session($0.connectionId)?.status == .authenticated }
        guard let first = connections.first(where: { $0.connectionId == SharedDefaults.lastConnectionId }) ?? connections.first, await configureConnection(first.connectionId) else {
            phase = .failed(ShareError.notSignedIn.localizedDescription)
            return
        }

        guard let payload = await ShareItemLoader.load(from: items) else {
            phase = .failed(ShareError.nothingToShare.localizedDescription)
            return
        }
        self.payload = payload
        caption = payload.initialCaption

        // A 4K video can be gigabytes. Refuse it here, named and measured,
        // rather than after a long upload that the server rejects at presign.
        // A Slack connection has no upload at all: the form still opens, with
        // the refusal under the attachment, so a Flow server can be picked.
        if let fileURL = payload.fileURL {
            fileSize = Self.size(of: fileURL)
            if !isSlack {
                maxFileBytes = await uploadLimit()
                if fileSize > maxFileBytes {
                    phase = .failed(
                        ShareError.fileTooLarge(size: fileSize, limit: maxFileBytes).localizedDescription
                    )
                    return
                }
            }
        }

        do {
            if let backend {
                workspaces = try await backend.listWorkspaces()
            } else {
                let resp: WorkspacesResponse = try await api.get("/v1/me/workspaces")
                workspaces = resp.workspaces
            }
        } catch {
            phase = .failed(message(for: error))
            return
        }

        // Preselect what was shared into last; fall back to the first
        // workspace so a first run is still one tap from sending.
        let remembered = SharedDefaults.lastConnectionId == connectionId ? SharedDefaults.lastWorkspaceId : nil
        workspaceId = workspaces.first(where: { $0.id == remembered })?.id ?? workspaces.first?.id
        await loadChannels(preselect: SharedDefaults.lastConnectionId == connectionId ? SharedDefaults.lastChannelId : nil)
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
            if let backend {
                channels = try await backend.listConversations(workspaceId: workspaceId)
                if let members = try? await backend.listMembers(workspaceId: workspaceId) {
                    memberNames = Dictionary(members.map { ($0.id, $0.displayName) }, uniquingKeysWith: { first, _ in first })
                }
            } else {
                let resp: ChannelsResponse = try await api.get("/v1/workspaces/\(workspaceId)/channels")
                channels = resp.channels
                if let members: MembersResponse = try? await api.get("/v1/workspaces/\(workspaceId)/members") {
                    memberNames = Dictionary(
                        members.members.map { ($0.userId, $0.displayName) },
                        uniquingKeysWith: { first, _ in first }
                    )
                }
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
            if let backend {
                // Text only. A file is refused by name, never dropped from the
                // message or uploaded anywhere else (#546).
                guard payload.fileURL == nil else { throw ShareError.slackFilesUnsupported }
                let body = caption.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !body.isEmpty else { throw ShareError.nothingToShare }
                _ = try await backend.send(SendMessageInput(channelId: channelId, body: body, clientMsgId: UUID().uuidString.lowercased()))
                SharedDefaults.lastConnectionId = connectionId
                SharedDefaults.lastChannelId = channelId
                SharedDefaults.lastWorkspaceId = workspaceId
                phase = .sent
                return
            }
            var fileIds: [String] = []
            var body = caption.trimmingCharacters(in: .whitespacesAndNewlines)
            // One path for every kind of file — image, video, document. Only
            // the *preparation* differs, and that already happened in the
            // loader.
            if let fileURL = payload.fileURL {
                let file = try await uploadFile(workspaceId: workspaceId, fileURL: fileURL)
                fileIds = [file.id]
            }
            // The server requires a non-empty body; an attachment with no
            // caption posts the same way the composer does.
            if body.isEmpty { body = " " }
            let _: Message = try await api.post(
                "/v1/channels/\(channelId)/messages",
                body: SendMessageBody(
                    clientMsgId: UUID().uuidString.lowercased(),
                    body: body,
                    fileIds: fileIds.isEmpty ? nil : fileIds
                )
            )
            SharedDefaults.lastConnectionId = connectionId
            SharedDefaults.lastChannelId = channelId
            SharedDefaults.lastWorkspaceId = workspaceId
            phase = .sent
        } catch {
            phase = .failed(message(for: error))
        }
    }

    /// Same three steps as `SyncEngine.uploadFile`, minus the cache write:
    /// presign → PUT the bytes from disk → complete. The PUT streams from the
    /// file, so a gigabyte video never lands in this process's memory — which
    /// is what keeps a share extension under its ~120 MB ceiling.
    private func uploadFile(workspaceId: String, fileURL: URL) async throws -> FileAttachment {
        struct PresignBody: Encodable, Sendable {
            let filename: String
            let mimeType: String
            let sizeBytes: Int
        }
        let pres: PresignedUpload = try await api.post(
            "/v1/workspaces/\(workspaceId)/files/presign",
            body: PresignBody(
                filename: fileURL.lastPathComponent,
                mimeType: Self.mimeType(for: fileURL),
                sizeBytes: Int(Self.size(of: fileURL))
            )
        )
        try await api.putRaw(pres.upload.url, headers: pres.upload.headers, fromFile: fileURL)
        return try await api.post("/v1/files/\(pres.file.id)/complete")
    }

    /// The server's own limit, so the client and the presign check agree even
    /// where `FLOW_MAX_FILE_MB` is set. `/v1/config` is public and cheap; a
    /// server that predates the field decodes as nil and gets the fallback.
    private func uploadLimit() async -> Int64 {
        struct PublicConfig: Decodable, Sendable {
            let maxFileBytes: Int64?
        }
        let config: PublicConfig? = try? await api.get("/v1/config")
        return config?.maxFileBytes ?? Self.fallbackMaxFileBytes
    }

    private static func size(of url: URL) -> Int64 {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    }

    /// Guessed from the extension, which the system's own type table answers
    /// well: `.mov` → `video/quicktime`, `.mp4` → `video/mp4`,
    /// `.pdf` → `application/pdf`, `.docx` →
    /// `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
    /// An extension the system does not know has no preferred MIME type, and
    /// `application/octet-stream` is the honest answer for it.
    private static func mimeType(for url: URL) -> String {
        UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }

    private func message(for error: Error) -> String {
        if let backendError = error as? BackendError {
            return backendError.code == .unauthorized ? ShareError.notSignedIn.localizedDescription : backendError.message
        }
        guard let api = error as? APIError else { return error.localizedDescription }
        if api.status == 401 { return ShareError.notSignedIn.localizedDescription }
        // The server states the limit in bytes ("files are limited to
        // 524288000 bytes"). Say it the way the pre-flight check does.
        if api.code == "file_too_large" {
            return ShareError.fileTooLarge(size: fileSize, limit: maxFileBytes).localizedDescription
        }
        return error.localizedDescription
    }
}
