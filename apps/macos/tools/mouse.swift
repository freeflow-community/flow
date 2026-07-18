// mouse move|click|drag tool via CGEvent.
// Usage: mouse move X Y | mouse click X Y | mouse drag X1 Y1 X2 Y2
import CoreGraphics
import Foundation
let args = CommandLine.arguments
guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else {
    print("usage: mouse move|click X Y  |  mouse drag X1 Y1 X2 Y2"); exit(2)
}
func post(_ type: CGEventType, _ pt: CGPoint, _ button: CGMouseButton = .left) {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: pt, mouseButton: button)?.post(tap: .cghidEventTap)
}
let pt = CGPoint(x: x, y: y)
switch args[1] {
case "move":
    post(.mouseMoved, pt)
case "click":
    post(.mouseMoved, pt)
    usleep(120_000)
    post(.leftMouseDown, pt)
    usleep(60_000)
    post(.leftMouseUp, pt)
case "drag":
    guard args.count >= 6, let x2 = Double(args[4]), let y2 = Double(args[5]) else {
        print("usage: mouse drag X1 Y1 X2 Y2"); exit(2)
    }
    post(.mouseMoved, pt)
    usleep(120_000)
    post(.leftMouseDown, pt)
    usleep(80_000)
    // interpolate so views tracking continuous drags update properly
    let steps = 12
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let mid = CGPoint(x: x + (x2 - x) * t, y: y + (y2 - y) * t)
        post(.leftMouseDragged, mid)
        usleep(16_000)
    }
    post(.leftMouseUp, CGPoint(x: x2, y: y2))
default:
    print("unknown"); exit(2)
}
