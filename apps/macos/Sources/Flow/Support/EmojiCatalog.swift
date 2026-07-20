import Foundation

/// Shortcode → unicode emoji, used by composer `:shortcode:` autocompletion
/// (bodies store plain unicode — phase2.md §8) and the quick-reaction picker.
enum EmojiCatalog {
    /// Curated shortcode map (Slack-compatible names for the common set).
    static let shortcodes: [String: String] = [
        "smile": "😄", "grin": "😁", "joy": "😂", "rofl": "🤣", "slightly_smiling_face": "🙂",
        "wink": "😉", "blush": "😊", "heart_eyes": "😍", "star_struck": "🤩", "thinking": "🤔",
        "neutral_face": "😐", "roll_eyes": "🙄", "smirk": "😏", "grimacing": "😬", "relieved": "😌",
        "cry": "😢", "sob": "😭", "angry": "😠", "rage": "😡", "exploding_head": "🤯",
        "scream": "😱", "sweat_smile": "😅", "zany_face": "🤪", "sunglasses": "😎", "nerd_face": "🤓",
        "sleeping": "😴", "shushing_face": "🤫", "face_with_hand_over_mouth": "🤭", "hugging": "🤗",
        "saluting_face": "🫡", "melting_face": "🫠", "skull": "💀", "clown_face": "🤡",
        "ghost": "👻", "alien": "👽", "robot": "🤖", "poop": "💩",
        "wave": "👋", "raised_hands": "🙌", "clap": "👏", "pray": "🙏", "handshake": "🤝",
        "thumbsup": "👍", "+1": "👍", "thumbsdown": "👎", "-1": "👎", "ok_hand": "👌",
        "v": "✌️", "crossed_fingers": "🤞", "point_up": "☝️", "point_right": "👉", "muscle": "💪",
        "eyes": "👀", "brain": "🧠", "ear": "👂", "facepalm": "🤦", "shrug": "🤷",
        "heart": "❤️", "orange_heart": "🧡", "yellow_heart": "💛", "green_heart": "💚",
        "blue_heart": "💙", "purple_heart": "💜", "black_heart": "🖤", "broken_heart": "💔",
        "sparkling_heart": "💖", "fire": "🔥", "sparkles": "✨", "star": "⭐", "star2": "🌟",
        "zap": "⚡", "boom": "💥", "dizzy": "💫", "100": "💯", "tada": "🎉", "confetti_ball": "🎊",
        "balloon": "🎈", "gift": "🎁", "trophy": "🏆", "medal": "🏅", "crown": "👑",
        "rocket": "🚀", "airplane": "✈️", "car": "🚗", "bike": "🚲", "ship": "🚢",
        "check": "✅", "white_check_mark": "✅", "x": "❌", "warning": "⚠️", "question": "❓",
        "exclamation": "❗", "no_entry": "⛔", "stop_sign": "🛑", "recycle": "♻️",
        "arrow_up": "⬆️", "arrow_down": "⬇️", "arrow_left": "⬅️", "arrow_right": "➡️",
        "red_circle": "🔴", "green_circle": "🟢", "yellow_circle": "🟡", "blue_circle": "🔵",
        "eyes_shaking": "👀", "hourglass": "⏳", "clock": "🕐", "alarm_clock": "⏰",
        "calendar": "📅", "pushpin": "📌", "paperclip": "📎", "scissors": "✂️",
        "memo": "📝", "pencil": "✏️", "book": "📖", "books": "📚", "bookmark": "🔖",
        "bulb": "💡", "flashlight": "🔦", "mag": "🔍", "lock": "🔒", "unlock": "🔓", "key": "🔑",
        "hammer": "🔨", "wrench": "🔧", "gear": "⚙️", "link": "🔗", "package": "📦",
        "inbox_tray": "📥", "outbox_tray": "📤", "email": "📧", "envelope": "✉️", "phone": "📱",
        "computer": "💻", "desktop_computer": "🖥️", "keyboard": "⌨️", "printer": "🖨️",
        "chart_with_upwards_trend": "📈", "chart_with_downwards_trend": "📉", "bar_chart": "📊",
        "clipboard": "📋", "file_folder": "📁", "camera": "📷", "video_camera": "📹",
        "movie_camera": "🎥", "microphone": "🎤", "headphones": "🎧", "musical_note": "🎵",
        "bell": "🔔", "no_bell": "🔕", "mega": "📣", "loudspeaker": "📢",
        "coffee": "☕", "tea": "🍵", "beer": "🍺", "beers": "🍻", "wine_glass": "🍷",
        "champagne": "🍾", "cocktail": "🍸", "pizza": "🍕", "hamburger": "🍔", "fries": "🍟",
        "taco": "🌮", "burrito": "🌯", "sushi": "🍣", "ramen": "🍜", "cake": "🍰",
        "birthday": "🎂", "cookie": "🍪", "doughnut": "🍩", "ice_cream": "🍨", "apple": "🍎",
        "banana": "🍌", "avocado": "🥑", "popcorn": "🍿",
        "dog": "🐶", "cat": "🐱", "mouse": "🐭", "rabbit": "🐰", "fox_face": "🦊",
        "bear": "🐻", "panda_face": "🐼", "koala": "🐨", "tiger": "🐯", "lion": "🦁",
        "cow": "🐮", "pig": "🐷", "frog": "🐸", "monkey_face": "🐵", "chicken": "🐔",
        "penguin": "🐧", "bird": "🐦", "duck": "🦆", "owl": "🦉", "unicorn_face": "🦄",
        "bee": "🐝", "bug": "🐛", "butterfly": "🦋", "snail": "🐌", "octopus": "🐙",
        "turtle": "🐢", "snake": "🐍", "dragon": "🐉", "whale": "🐳", "dolphin": "🐬",
        "sun": "☀️", "sunny": "☀️", "moon": "🌙", "earth_americas": "🌎", "rainbow": "🌈",
        "cloud": "☁️", "rain_cloud": "🌧️", "snowflake": "❄️", "snowman": "⛄", "umbrella": "☂️",
        "ocean": "🌊", "mountain": "⛰️", "volcano": "🌋", "desert_island": "🏝️",
        "tree": "🌳", "evergreen_tree": "🌲", "palm_tree": "🌴", "cactus": "🌵",
        "seedling": "🌱", "herb": "🌿", "four_leaf_clover": "🍀", "rose": "🌹",
        "sunflower": "🌻", "tulip": "🌷", "cherry_blossom": "🌸", "bouquet": "💐",
        "soccer": "⚽", "basketball": "🏀", "football": "🏈", "baseball": "⚾",
        "tennis": "🎾", "8ball": "🎱", "dart": "🎯", "video_game": "🎮", "game_die": "🎲",
        "guitar": "🎸", "art": "🎨", "circus_tent": "🎪", "microscope": "🔬",
        "telescope": "🔭", "dna": "🧬", "pill": "💊", "syringe": "💉",
        "money_with_wings": "💸", "moneybag": "💰", "dollar": "💵", "gem": "💎",
        "house": "🏠", "office": "🏢", "hospital": "🏥", "school": "🏫", "hotel": "🏨",
        "church": "⛪", "castle": "🏰", "statue_of_liberty": "🗽", "tokyo_tower": "🗼",
        "bomb": "💣", "gun": "🔫", "knife": "🔪", "shield": "🛡️", "crossed_swords": "⚔️",
        "zzz": "💤", "speech_balloon": "💬", "thought_balloon": "💭", "anger": "💢",
        "sweat_drops": "💦", "dash": "💨", "footprints": "👣",
    ]

    /// The quick-reaction picker set, in display order.
    static let quickReactions: [String] = [
        "👍", "👎", "❤️", "😂", "😄", "🎉", "🚀", "👀",
        "🙏", "👏", "🔥", "💯", "✅", "❌", "🤔", "😢",
        "😍", "🤯", "😅", "🙌", "💪", "☕", "🍕", "⭐",
        "⚡", "🐛", "💡", "📌", "🎯", "🏆", "🫡", "💀",
    ]

    /// Autocomplete candidates for a shortcode query, best matches first.
    /// Substring match (ui_nits): "fire" finds mid-name hits too; codes that
    /// start with the query rank ahead of them.
    static func matches(query: String, limit: Int = 8) -> [(code: String, emoji: String)] {
        guard !query.isEmpty else { return [] }
        let lower = query.lowercased()
        return shortcodes
            .filter { $0.key.contains(lower) }
            .sorted {
                ($0.key.hasPrefix(lower) ? 0 : 1, $0.key.count, $0.key)
                    < ($1.key.hasPrefix(lower) ? 0 : 1, $1.key.count, $1.key)
            }
            .prefix(limit)
            .map { (code: $0.key, emoji: $0.value) }
    }

    /// Expands `:shortcode:` tokens to unicode (unknown codes left untouched).
    static func expandShortcodes(_ text: String) -> String {
        guard text.contains(":") else { return text }
        var out = ""
        var rest = Substring(text)
        while let start = rest.firstIndex(of: ":") {
            out += rest[..<start]
            let afterColon = rest.index(after: start)
            guard let end = rest[afterColon...].firstIndex(of: ":"), end > afterColon,
                  case let code = String(rest[afterColon..<end]),
                  code.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "+" || $0 == "-" })
            else {
                out += String(rest[start])
                rest = rest[afterColon...]
                continue
            }
            if let emoji = shortcodes[code.lowercased()] {
                out += emoji
                rest = rest[rest.index(after: end)...]
            } else {
                out += String(rest[start])
                rest = rest[afterColon...]
            }
        }
        out += rest
        return out
    }
}
