// mouse move|click|drag tool via CGEvent. Usage: mouse move X Y | mouse click X Y
import CoreGraphics
import Foundation
let args = CommandLine.arguments
guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else {
    print("usage: mouse move|click X Y"); exit(2)
}
let pt = CGPoint(x: x, y: y)
func post(_ type: CGEventType, _ button: CGMouseButton = .left) {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: pt, mouseButton: button)?.post(tap: .cghidEventTap)
}
switch args[1] {
case "move":
    post(.mouseMoved)
case "click":
    post(.mouseMoved)
    usleep(120_000)
    post(.leftMouseDown)
    usleep(60_000)
    post(.leftMouseUp)
default:
    print("unknown"); exit(2)
}
