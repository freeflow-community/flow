// DMG install-window background — the "drag Flow onto Applications" canvas.
// CoreGraphics only (matches make-icon.swift), on the "quiet, in violet" brand.
// Drawn in *points* for a 660×420-pt install window, at a given pixel scale.
// dmgbuild's HiDPI support combines the 1× and @2×  files into one TIFF, so
// Finder renders it at the logical size (crisp on Retina) — a plain @2× PNG
// would otherwise render at double size and blow the layout out.
// The Flow.app / Applications icons are drawn by dmgbuild on top at the
// positions in tools/dmg-settings.py — this image only paints the ground, the
// title, and the arrow between them.
//
//   swift make-dmg-bg.swift <out.png> [scale]     (scale: 1 or 2, default 1)
import CoreGraphics
import CoreText
import ImageIO
import Foundation
import UniformTypeIdentifiers

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> CGColor {
    CGColor(colorSpace: sRGB, components: [CGFloat(r / 255), CGFloat(g / 255), CGFloat(b / 255), CGFloat(a)])!
}

let violet = rgb(124, 58, 237)      // accent arrow shaft
let violetDeep = rgb(74, 27, 150)   // arrowhead
let inkTitle = rgb(30, 27, 46)
let inkSub = rgb(120, 118, 132)
let bgTop = rgb(255, 255, 255)
let bgBot = rgb(238, 234, 249)

let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "dmg-background.png"
let s: CGFloat = CommandLine.arguments.count > 2 ? CGFloat(Double(CommandLine.arguments[2]) ?? 1) : 1

// Logical window is 660×420 pt. Everything below is in points × scale.
let WP: CGFloat = 660, HP: CGFloat = 420
let W = WP * s, H = HP * s
let ctx = CGContext(data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8, bytesPerRow: 0,
                    space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setAllowsAntialiasing(true)
ctx.interpolationQuality = .high
ctx.scaleBy(x: s, y: s)   // draw in point space; the bitmap is scale× denser

// --- ground: soft vertical wash ---------------------------------------------
let grad = CGGradient(colorsSpace: sRGB, colors: [bgTop, bgBot] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: HP), end: CGPoint(x: 0, y: 0), options: [])

// Icon centres in points (CG origin = bottom-left), mirroring dmg-settings.py's
// icon_locations {Flow (180,250), Applications (480,250)} which use a top-left
// origin — so flip Y: pt_from_bottom = HP - y_top.
let iconY = HP - 250        // 170 from bottom
let flowX: CGFloat = 180
let appsX: CGFloat = 480

// --- centred text via CoreText ----------------------------------------------
func font(_ name: String, _ size: CGFloat) -> CTFont { CTFontCreateWithName(name as CFString, size, nil) }
func drawCentered(_ str: String, font f: CTFont, color: CGColor, cx: CGFloat, y: CGFloat) {
    let attrs = [kCTFontAttributeName: f, kCTForegroundColorAttributeName: color] as CFDictionary
    let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, str as CFString, attrs)!)
    let bounds = CTLineGetBoundsWithOptions(line, .useOpticalBounds)
    ctx.textPosition = CGPoint(x: cx - bounds.width / 2, y: y)
    CTLineDraw(line, ctx)
}

drawCentered("Install Flow", font: font("HelveticaNeue-Bold", 26), color: inkTitle, cx: WP / 2, y: HP - 58)
drawCentered("Drag the Flow icon onto the Applications folder",
             font: font("HelveticaNeue", 15), color: inkSub, cx: WP / 2, y: HP - 92)

// --- the arrow ---------------------------------------------------------------
// A thick rounded shaft from just right of Flow to just left of Applications,
// with a triangular head pointing at Applications, sitting on the icon row.
let iconHalf: CGFloat = 64          // 128-pt icon → 64-pt half width
let startX = flowX + iconHalf + 8
let endX = appsX - iconHalf - 8
let headLen: CGFloat = 24
let shaftEnd = endX - headLen

ctx.setStrokeColor(violet)
ctx.setLineCap(.round)
ctx.setLineWidth(10)
ctx.move(to: CGPoint(x: startX, y: iconY))
ctx.addLine(to: CGPoint(x: shaftEnd, y: iconY))
ctx.strokePath()

ctx.setFillColor(violetDeep)
ctx.beginPath()
ctx.move(to: CGPoint(x: endX, y: iconY))
ctx.addLine(to: CGPoint(x: shaftEnd - 2, y: iconY + 18))
ctx.addLine(to: CGPoint(x: shaftEnd - 2, y: iconY - 18))
ctx.closePath()
ctx.fillPath()

// --- write PNG ---------------------------------------------------------------
let url = URL(fileURLWithPath: outPath) as CFURL
let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("failed to write \(outPath)") }
print("wrote \(outPath) (\(Int(W))×\(Int(H)))")
