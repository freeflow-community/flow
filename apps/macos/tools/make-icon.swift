// Flow app icon — programmatic, resolution-independent, crisp down to 16px.
// "Quiet, in violet" brand: violet gradient ground + white chat bubble whose
// interior carries a two-line "flow" wave. Single source of truth for both the
// macOS .icns and the iOS AppIcon asset — re-run tools/make-icon.sh to regen.
//
//   swift make-icon.swift <macos-iconset-dir> <ios-1024-png>
import CoreGraphics
import ImageIO
import Foundation
import UniformTypeIdentifiers

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

func rgb(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> CGColor {
    CGColor(colorSpace: sRGB, components: [CGFloat(r/255), CGFloat(g/255), CGFloat(b/255), CGFloat(a)])!
}

let violetTop = rgb(141, 84, 226)   // lighter violet (top-left)
let violetBot = rgb(74, 27, 150)    // deep violet (bottom-right)
let bubbleFill = rgb(255, 255, 255)
let waveColor  = rgb(107, 48, 175)  // brand accent ≈ oklch(0.46 0.19 300)

func roundedSquare(_ s: CGFloat, inset: CGFloat, radiusRatio: CGFloat) -> CGPath {
    let r = CGRect(x: inset, y: inset, width: s - 2*inset, height: s - 2*inset)
    return CGPath(roundedRect: r, cornerWidth: r.width*radiusRatio, cornerHeight: r.height*radiusRatio, transform: nil)
}

func bubblePath(_ s: CGFloat) -> CGPath {
    let w = s * 0.60, h = s * 0.50
    let cx = s * 0.50, cy = s * 0.545
    let body = CGRect(x: cx - w/2, y: cy - h/2, width: w, height: h)
    let path = CGMutablePath()
    path.addRoundedRect(in: body, cornerWidth: s*0.15, cornerHeight: s*0.15)
    let tail = CGMutablePath()
    let bx = body.minX + w*0.24
    let by = body.minY + s*0.02
    tail.move(to: CGPoint(x: bx, y: by))
    tail.addCurve(to: CGPoint(x: bx - s*0.11, y: by - s*0.135),
                  control1: CGPoint(x: bx - s*0.01, y: by - s*0.02),
                  control2: CGPoint(x: bx - s*0.075, y: by - s*0.075))
    tail.addCurve(to: CGPoint(x: bx + s*0.11, y: by),
                  control1: CGPoint(x: bx + s*0.02, y: by - s*0.05),
                  control2: CGPoint(x: bx + s*0.09, y: by))
    tail.closeSubpath()
    path.addPath(tail)
    return path
}

func wavePath(_ s: CGFloat, x0: CGFloat, x1: CGFloat, y: CGFloat, amp: CGFloat, width: CGFloat) -> CGPath {
    let steps = 64
    let mid = CGMutablePath()
    for i in 0...steps {
        let t = CGFloat(i)/CGFloat(steps)
        let x = x0 + (x1 - x0)*t
        let yy = y + sin(t * .pi * 2) * amp
        if i == 0 { mid.move(to: CGPoint(x: x, y: yy)) } else { mid.addLine(to: CGPoint(x: x, y: yy)) }
    }
    return mid.copy(strokingWithWidth: width, lineCap: .round, lineJoin: .round, miterLimit: 10)
}

func draw(_ px: Int, rounded: Bool) -> CGImage {
    let s = CGFloat(px)
    let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0,
                        space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.setAllowsAntialiasing(true)

    let inset: CGFloat = rounded ? s*0.06 : 0
    let ground = rounded ? roundedSquare(s, inset: inset, radiusRatio: 0.2237)
                         : CGPath(rect: CGRect(x: 0, y: 0, width: s, height: s), transform: nil)

    if rounded {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -s*0.012), blur: s*0.03, color: rgb(0, 0, 0, 0.28))
        ctx.addPath(ground); ctx.setFillColor(rgb(0,0,0,1)); ctx.fillPath()
        ctx.restoreGState()
    }

    ctx.saveGState()
    ctx.addPath(ground); ctx.clip()
    let grad = CGGradient(colorsSpace: sRGB, colors: [violetTop, violetBot] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(grad, start: CGPoint(x: inset, y: s - inset),
                           end: CGPoint(x: s - inset, y: inset), options: [])
    ctx.restoreGState()

    ctx.addPath(bubblePath(s)); ctx.setFillColor(bubbleFill); ctx.fillPath()

    let cx = s*0.50, cy = s*0.545
    let amp = s*0.028, lw = s*0.052
    ctx.setFillColor(waveColor)
    ctx.addPath(wavePath(s, x0: cx - s*0.155, x1: cx + s*0.155, y: cy + s*0.052, amp: amp, width: lw)); ctx.fillPath()
    ctx.addPath(wavePath(s, x0: cx - s*0.155, x1: cx + s*0.055, y: cy - s*0.052, amp: amp, width: lw)); ctx.fillPath()

    return ctx.makeImage()!
}

func write(_ img: CGImage, to path: String) {
    let url = URL(fileURLWithPath: path)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, nil)
    CGImageDestinationFinalize(dest)
}

let args = CommandLine.arguments
guard args.count >= 3 else { FileHandle.standardError.write(Data("usage: make-icon.swift <macos-iconset-dir> <ios-1024-png>\n".utf8)); exit(2) }
let iconset = args[1], iosPng = args[2]
let fm = FileManager.default
try? fm.createDirectory(atPath: iconset, withIntermediateDirectories: true)
try? fm.createDirectory(atPath: (iosPng as NSString).deletingLastPathComponent, withIntermediateDirectories: true)

// macOS .iconset (rounded squircle) — the ten names iconutil expects.
let macSizes: [(String, Int)] = [
    ("icon_16x16",     16), ("icon_16x16@2x",   32),
    ("icon_32x32",     32), ("icon_32x32@2x",   64),
    ("icon_128x128",  128), ("icon_128x128@2x", 256),
    ("icon_256x256",  256), ("icon_256x256@2x", 512),
    ("icon_512x512",  512), ("icon_512x512@2x", 1024),
]
for (name, px) in macSizes { write(draw(px, rounded: true), to: "\(iconset)/\(name).png") }

// iOS single-size master (full-bleed; the system applies the mask).
write(draw(1024, rounded: false), to: iosPng)

print("wrote \(macSizes.count) macOS tiles → \(iconset)")
print("wrote iOS 1024 master → \(iosPng)")
