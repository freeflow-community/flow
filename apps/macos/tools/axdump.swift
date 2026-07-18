// axdump — dump a process's window UI tree as JSON lines via the Accessibility API.
// Built for QA automation: each element prints role, AXIdentifier, title, value,
// and its global frame, so a driver can read UI state and compute click targets
// without screenshots. Requires the invoking terminal to have Accessibility permission.
//
// Build: swiftc -O axdump.swift -o axdump
// Usage: axdump <pid> [maxDepth=30]
// Output: one JSON object per element: {"role","id","title","value","frame":[x,y,w,h],"depth"}

import ApplicationServices
import Foundation

let args = CommandLine.arguments
guard args.count >= 2, let pidArg = Int32(args[1]) else {
    FileHandle.standardError.write(Data("usage: axdump <pid> [maxDepth]\n".utf8))
    exit(2)
}
let maxDepth = args.count > 2 ? (Int(args[2]) ?? 30) : 30

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

func frame(of el: AXUIElement) -> CGRect? {
    guard let posV = attr(el, kAXPositionAttribute), CFGetTypeID(posV) == AXValueGetTypeID(),
          let sizeV = attr(el, kAXSizeAttribute), CFGetTypeID(sizeV) == AXValueGetTypeID()
    else { return nil }
    var p = CGPoint.zero
    var s = CGSize.zero
    AXValueGetValue(posV as! AXValue, .cgPoint, &p)
    AXValueGetValue(sizeV as! AXValue, .cgSize, &s)
    return CGRect(origin: p, size: s)
}

let out = FileHandle.standardOutput
func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    out.write(data)
    out.write(Data("\n".utf8))
}

func walk(_ el: AXUIElement, _ depth: Int) {
    if depth > maxDepth { return }
    var obj: [String: Any] = ["depth": depth]
    obj["role"] = (attr(el, kAXRoleAttribute) as? String) ?? "?"
    if let id = attr(el, "AXIdentifier") as? String, !id.isEmpty { obj["id"] = id }
    if let title = attr(el, kAXTitleAttribute) as? String, !title.isEmpty { obj["title"] = title }
    if let v = attr(el, kAXValueAttribute) {
        let s = (v as? String) ?? "\(v)"
        if !s.isEmpty { obj["value"] = s }
    }
    if let d = attr(el, kAXDescriptionAttribute) as? String, !d.isEmpty { obj["desc"] = d }
    if let f = frame(of: el) {
        obj["frame"] = [Int(f.origin.x), Int(f.origin.y), Int(f.width), Int(f.height)]
    }
    emit(obj)
    if let children = attr(el, kAXChildrenAttribute) as? [AXUIElement] {
        for c in children { walk(c, depth + 1) }
    }
}

let app = AXUIElementCreateApplication(pidArg)
guard let windows = attr(app, kAXWindowsAttribute) as? [AXUIElement], !windows.isEmpty else {
    FileHandle.standardError.write(Data("no windows (bad pid, or missing Accessibility permission)\n".utf8))
    exit(1)
}
for w in windows { walk(w, 0) }
