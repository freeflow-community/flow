import SwiftUI
import UIKit

/// Pinch, pan and double-tap zoom for a full-screen image, shared by the chat
/// lightbox (`ImageLightboxView`) and the image artifact pane
/// (`ArtifactImagePane`).
///
/// UIKit owns the gestures on purpose: a `UIScrollView` with `viewForZooming`
/// gives pan, momentum, rubber-band bounce and pinch-to-centre for free, where
/// a SwiftUI `MagnificationGesture` plus a drag gesture is more code and
/// behaves worse at the limits. The content is arbitrary SwiftUI so both the
/// still-image and the animated-GIF branch can go through it unchanged.
struct ZoomableImageView<Content: View>: UIViewRepresentable {
    /// Identity of what is on screen. When it changes the zoom resets, so a
    /// second image never inherits the first one's scale.
    let contentId: String
    /// True while zoomed in. The artifact pane feeds it to
    /// `.interactiveDismissDisabled` so a downward pan moves the image instead
    /// of closing the sheet.
    @Binding var isZoomed: Bool
    @ViewBuilder let content: () -> Content

    private static var maxScale: CGFloat { 4 }
    private static var doubleTapScale: CGFloat { 2.5 }

    func makeUIView(context: Context) -> UIScrollView {
        let scrollView = CenteringScrollView()
        scrollView.delegate = context.coordinator
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = Self.maxScale
        scrollView.bouncesZoom = true
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.showsVerticalScrollIndicator = false
        scrollView.backgroundColor = .clear
        scrollView.contentInsetAdjustmentBehavior = .never

        let hosted = context.coordinator.host.view!
        hosted.backgroundColor = .clear
        hosted.frame = scrollView.bounds
        scrollView.addSubview(hosted)
        scrollView.hosted = hosted

        let doubleTap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleDoubleTap(_:))
        )
        doubleTap.numberOfTapsRequired = 2
        scrollView.addGestureRecognizer(doubleTap)

        return scrollView
    }

    func updateUIView(_ scrollView: UIScrollView, context: Context) {
        context.coordinator.host.rootView = content()
        context.coordinator.isZoomed = $isZoomed
        if context.coordinator.contentId != contentId {
            context.coordinator.contentId = contentId
            scrollView.setZoomScale(scrollView.minimumZoomScale, animated: false)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(host: UIHostingController(rootView: content()),
                    contentId: contentId,
                    isZoomed: $isZoomed)
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        let host: UIHostingController<Content>
        var contentId: String
        var isZoomed: Binding<Bool>

        init(host: UIHostingController<Content>, contentId: String, isZoomed: Binding<Bool>) {
            self.host = host
            self.contentId = contentId
            self.isZoomed = isZoomed
            super.init()
            host.view.backgroundColor = .clear
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { host.view }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            (scrollView as? CenteringScrollView)?.centreContent()
            let zoomed = scrollView.zoomScale > scrollView.minimumZoomScale + 0.01
            guard zoomed != isZoomed.wrappedValue else { return }
            // Off the gesture's own turn: this fires mid-layout, and writing
            // SwiftUI state there is the "modifying state during update" warning.
            DispatchQueue.main.async { [isZoomed] in isZoomed.wrappedValue = zoomed }
        }

        /// Double tap zooms to the tapped point; a second one returns to fit.
        @objc func handleDoubleTap(_ recognizer: UITapGestureRecognizer) {
            guard let scrollView = recognizer.view as? UIScrollView else { return }
            if scrollView.zoomScale > scrollView.minimumZoomScale + 0.01 {
                scrollView.setZoomScale(scrollView.minimumZoomScale, animated: true)
                return
            }
            let scale = min(scrollView.maximumZoomScale, ZoomableImageView.doubleTapScale)
            let point = recognizer.location(in: host.view)
            let size = CGSize(width: scrollView.bounds.width / scale,
                              height: scrollView.bounds.height / scale)
            scrollView.zoom(to: CGRect(x: point.x - size.width / 2,
                                       y: point.y - size.height / 2,
                                       width: size.width,
                                       height: size.height),
                            animated: true)
        }
    }
}

/// Keeps the hosted view the size of the scroll view at fit scale, and centred
/// while it is smaller than the viewport (the usual case for a `.scaledToFit`
/// image, which leaves letterbox space on one axis).
private final class CenteringScrollView: UIScrollView {
    var hosted: UIView?

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let hosted else { return }
        // Only at fit scale: while zoomed the frame carries UIScrollView's own
        // transform and must be left alone.
        if abs(zoomScale - minimumZoomScale) < 0.01, hosted.frame.size != bounds.size {
            hosted.frame = CGRect(origin: .zero, size: bounds.size)
            contentSize = bounds.size
        }
        centreContent()
    }

    func centreContent() {
        guard let hosted else { return }
        let x = max(0, (bounds.width - hosted.frame.width) / 2)
        let y = max(0, (bounds.height - hosted.frame.height) / 2)
        if contentInset != UIEdgeInsets(top: y, left: x, bottom: y, right: x) {
            contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
        }
    }
}
