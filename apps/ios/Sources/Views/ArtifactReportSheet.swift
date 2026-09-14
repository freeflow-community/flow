import SwiftUI

/// A report opened from its durable conversation card or a delivery event.
struct ArtifactReportSheet: View {
    let artifactId: String
    @EnvironmentObject private var app: AppState
    @State private var report: Artifact?
    @State private var text: String?
    @State private var error: String?
    @State private var attempt = 0

    var body: some View {
        NavigationStack {
            Group {
                if let error {
                    VStack(spacing: 12) {
                        Text(error)
                        Button("Retry") { attempt += 1 }
                    }.padding()
                } else if let text {
                    ScrollView {
                        if report?.file?.isMarkdownReport == true {
                            ReportMarkdownView(text: text).padding()
                        } else {
                            Text(text).font(.system(.body, design: .monospaced)).textSelection(.enabled).padding()
                        }
                    }
                } else { ProgressView("Opening report…") }
            }
            .navigationTitle(report?.name ?? "Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button("Done") { app.selectArtifact(nil) }
            } }
            .task(id: "\(artifactId)-\(attempt)-\(app.artifacts.first(where: { $0.id == artifactId })?.updatedAt ?? "")") {
                error = nil
                text = nil
                do {
                    let saved = try await app.engine.fetchArtifact(id: artifactId)
                    report = saved
                    guard let file = saved.file, file.isTextPreviewable, !file.isHTML else {
                        error = "This report format is not supported on iPhone yet. Open it in Flow on web or Mac."
                        return
                    }
                    let content = try await app.engine.fileText(file)
                    text = String(content.prefix(1_000_000))
                    if content.count > 1_000_000 { text? += "\n\nReport preview truncated. Open on web or Mac for the full export." }
                } catch { self.error = "Could not load this report. It may have been deleted or access changed." }
            }
        }
    }
}
