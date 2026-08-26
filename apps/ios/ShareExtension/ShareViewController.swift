// Share extension entry point (issue #214) — the NSExtensionPrincipalClass
// named in project.yml. Hosts the SwiftUI sheet and owns the one thing UIKit
// still has to do here: telling the host app we're finished.
import SwiftUI
import UIKit

final class ShareViewController: UIViewController {
    private let store = ShareStore()

    override func viewDidLoad() {
        super.viewDidLoad()

        let host = UIHostingController(
            rootView: ShareView(
                store: store,
                onFinish: { [weak self] in self?.finish() },
                onCancel: { [weak self] in self?.cancel() }
            )
        )
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        Task { await store.start(items: items) }
    }

    /// Held open until the upload finishes — `completeRequest` tears the
    /// process down, and v1 has no background session to survive that
    /// (issue #214, failure mode 3). The delay is only so "Sent" is readable —
    /// long enough for a person, and for a UI test polling for it.
    private func finish() {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(1500))
            extensionContext?.completeRequest(returningItems: nil)
        }
    }

    private func cancel() {
        extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
    }
}
