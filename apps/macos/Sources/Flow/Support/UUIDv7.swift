import Foundation

/// Generates UUIDv7 strings (time-ordered). Used for optimistic local message
/// rows so they sort chronologically alongside server-issued ids.
enum UUIDv7 {
    static func generate(date: Date = Date()) -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        let ms = UInt64(date.timeIntervalSince1970 * 1000)
        bytes[0] = UInt8((ms >> 40) & 0xff)
        bytes[1] = UInt8((ms >> 32) & 0xff)
        bytes[2] = UInt8((ms >> 24) & 0xff)
        bytes[3] = UInt8((ms >> 16) & 0xff)
        bytes[4] = UInt8((ms >> 8) & 0xff)
        bytes[5] = UInt8(ms & 0xff)
        for i in 6..<16 {
            bytes[i] = UInt8.random(in: 0...255)
        }
        bytes[6] = (bytes[6] & 0x0f) | 0x70 // version 7
        bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant
        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        var s = hex
        s.insert("-", at: s.index(s.startIndex, offsetBy: 8))
        s.insert("-", at: s.index(s.startIndex, offsetBy: 13))
        s.insert("-", at: s.index(s.startIndex, offsetBy: 18))
        s.insert("-", at: s.index(s.startIndex, offsetBy: 23))
        return s
    }
}
