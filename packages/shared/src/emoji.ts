// Emoji catalog shared by web clients (phase2.md §8): shortcode → unicode map
// and the quick-reaction set. Bodies store plain unicode — shortcodes are a
// client-side composer affordance only. The macOS client keeps a Swift copy
// (apps/macos/Sources/Flow/Support/EmojiCatalog.swift) — keep them aligned.

export const EMOJI_SHORTCODES: Record<string, string> = {
  smile: '😄', grin: '😁', joy: '😂', rofl: '🤣', slightly_smiling_face: '🙂',
  wink: '😉', blush: '😊', heart_eyes: '😍', star_struck: '🤩', thinking: '🤔',
  neutral_face: '😐', roll_eyes: '🙄', smirk: '😏', grimacing: '😬', relieved: '😌',
  cry: '😢', sob: '😭', angry: '😠', rage: '😡', exploding_head: '🤯',
  scream: '😱', sweat_smile: '😅', zany_face: '🤪', sunglasses: '😎', nerd_face: '🤓',
  sleeping: '😴', shushing_face: '🤫', face_with_hand_over_mouth: '🤭', hugging: '🤗',
  saluting_face: '🫡', melting_face: '🫠', skull: '💀', clown_face: '🤡',
  ghost: '👻', alien: '👽', robot: '🤖', poop: '💩',
  wave: '👋', raised_hands: '🙌', clap: '👏', pray: '🙏', handshake: '🤝',
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', ok_hand: '👌',
  v: '✌️', crossed_fingers: '🤞', point_up: '☝️', point_right: '👉', muscle: '💪',
  eyes: '👀', brain: '🧠', ear: '👂', facepalm: '🤦', shrug: '🤷',
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚',
  blue_heart: '💙', purple_heart: '💜', black_heart: '🖤', broken_heart: '💔',
  sparkling_heart: '💖', fire: '🔥', sparkles: '✨', star: '⭐', star2: '🌟',
  zap: '⚡', boom: '💥', dizzy: '💫', '100': '💯', tada: '🎉', confetti_ball: '🎊',
  balloon: '🎈', gift: '🎁', trophy: '🏆', medal: '🏅', crown: '👑',
  rocket: '🚀', airplane: '✈️', car: '🚗', bike: '🚲', ship: '🚢',
  check: '✅', white_check_mark: '✅', x: '❌', warning: '⚠️', question: '❓',
  exclamation: '❗', no_entry: '⛔', stop_sign: '🛑', recycle: '♻️',
  arrow_up: '⬆️', arrow_down: '⬇️', arrow_left: '⬅️', arrow_right: '➡️',
  red_circle: '🔴', green_circle: '🟢', yellow_circle: '🟡', blue_circle: '🔵',
  hourglass: '⏳', clock: '🕐', alarm_clock: '⏰',
  calendar: '📅', pushpin: '📌', paperclip: '📎', scissors: '✂️',
  memo: '📝', pencil: '✏️', book: '📖', books: '📚', bookmark: '🔖',
  bulb: '💡', flashlight: '🔦', mag: '🔍', lock: '🔒', unlock: '🔓', key: '🔑',
  hammer: '🔨', wrench: '🔧', gear: '⚙️', link: '🔗', package: '📦',
  inbox_tray: '📥', outbox_tray: '📤', email: '📧', envelope: '✉️', phone: '📱',
  computer: '💻', desktop_computer: '🖥️', keyboard: '⌨️', printer: '🖨️',
  chart_with_upwards_trend: '📈', chart_with_downwards_trend: '📉', bar_chart: '📊',
  clipboard: '📋', file_folder: '📁', camera: '📷', video_camera: '📹',
  movie_camera: '🎥', microphone: '🎤', headphones: '🎧', musical_note: '🎵',
  bell: '🔔', no_bell: '🔕', mega: '📣', loudspeaker: '📢',
  coffee: '☕', tea: '🍵', beer: '🍺', beers: '🍻', wine_glass: '🍷',
  champagne: '🍾', cocktail: '🍸', pizza: '🍕', hamburger: '🍔', fries: '🍟',
  taco: '🌮', burrito: '🌯', sushi: '🍣', ramen: '🍜', cake: '🍰',
  birthday: '🎂', cookie: '🍪', doughnut: '🍩', ice_cream: '🍨', apple: '🍎',
  banana: '🍌', avocado: '🥑', popcorn: '🍿',
  dog: '🐶', cat: '🐱', mouse: '🐭', rabbit: '🐰', fox_face: '🦊',
  bear: '🐻', panda_face: '🐼', koala: '🐨', tiger: '🐯', lion: '🦁',
  cow: '🐮', pig: '🐷', frog: '🐸', monkey_face: '🐵', chicken: '🐔',
  penguin: '🐧', bird: '🐦', duck: '🦆', owl: '🦉', unicorn_face: '🦄',
  bee: '🐝', bug: '🐛', butterfly: '🦋', snail: '🐌', octopus: '🐙',
  turtle: '🐢', snake: '🐍', dragon: '🐉', whale: '🐳', dolphin: '🐬',
  sun: '☀️', sunny: '☀️', moon: '🌙', earth_americas: '🌎', rainbow: '🌈',
  cloud: '☁️', rain_cloud: '🌧️', snowflake: '❄️', snowman: '⛄', umbrella: '☂️',
  ocean: '🌊', mountain: '⛰️', volcano: '🌋', desert_island: '🏝️',
  tree: '🌳', evergreen_tree: '🌲', palm_tree: '🌴', cactus: '🌵',
  seedling: '🌱', herb: '🌿', four_leaf_clover: '🍀', rose: '🌹',
  sunflower: '🌻', tulip: '🌷', cherry_blossom: '🌸', bouquet: '💐',
  soccer: '⚽', basketball: '🏀', football: '🏈', baseball: '⚾',
  tennis: '🎾', '8ball': '🎱', dart: '🎯', video_game: '🎮', game_die: '🎲',
  guitar: '🎸', art: '🎨', circus_tent: '🎪', microscope: '🔬',
  telescope: '🔭', dna: '🧬', pill: '💊', syringe: '💉',
  money_with_wings: '💸', moneybag: '💰', dollar: '💵', gem: '💎',
  house: '🏠', office: '🏢', hospital: '🏥', school: '🏫', hotel: '🏨',
  church: '⛪', castle: '🏰', statue_of_liberty: '🗽', tokyo_tower: '🗼',
  bomb: '💣', shield: '🛡️', crossed_swords: '⚔️',
  zzz: '💤', speech_balloon: '💬', thought_balloon: '💭', anger: '💢',
  sweat_drops: '💦', dash: '💨', footprints: '👣',
  // Common Slack aliases (retired ui_nits list): frequently typed shortcodes
  // and reaction names that were missing from the curated set above.
  thread: '🧵', spool: '🧵',
  smiley: '😃', laughing: '😆', satisfied: '😆', upside_down_face: '🙃',
  yum: '😋', stuck_out_tongue: '😛', stuck_out_tongue_winking_eye: '😜',
  kissing_heart: '😘', money_mouth_face: '🤑', innocent: '😇',
  smiling_imp: '😈', imp: '👿', confused: '😕', worried: '😟',
  slightly_frowning_face: '🙁', open_mouth: '😮', astonished: '😲',
  flushed: '😳', pleading_face: '🥺', disappointed: '😞', pensive: '😔',
  confounded: '😖', tired_face: '😫', weary: '😩', triumph: '😤',
  fearful: '😨', cold_sweat: '😰', sleepy: '😪', no_mouth: '😶',
  mask: '😷', unamused: '😒', expressionless: '😑', partying_face: '🥳',
  point_down: '👇', point_left: '👈', point_up_2: '👆', raised_hand: '✋',
  open_hands: '👐', fist: '✊', fist_raised: '✊', punch: '👊', facepunch: '👊',
  call_me_hand: '🤙', writing_hand: '✍️', vulcan_salute: '🖖', raising_hand: '🙋',
  heavy_check_mark: '✔️', ballot_box_with_check: '☑️', heavy_plus_sign: '➕',
  heavy_minus_sign: '➖', heavy_multiplication_x: '✖️', heavy_division_sign: '➗',
  heavy_dollar_sign: '💲', bangbang: '‼️', interrobang: '⁉️',
  grey_question: '❔', grey_exclamation: '❕', sos: '🆘', ok: '🆗', new: '🆕',
  cool: '🆒', up: '🆙', top: '🔝', back: '🔙', repeat: '🔁',
  arrows_counterclockwise: '🔄', arrow_forward: '▶️', arrow_backward: '◀️',
  watch: '⌚', stopwatch: '⏱️',
};

/** The quick-reaction picker set, in display order. */
export const QUICK_REACTIONS: string[] = [
  '👍', '👎', '❤️', '😂', '😄', '🎉', '🚀', '👀',
  '🙏', '👏', '🔥', '💯', '✅', '❌', '🤔', '😢',
  '😍', '🤯', '😅', '🙌', '💪', '☕', '🍕', '⭐',
  '⚡', '🐛', '💡', '📌', '🎯', '🏆', '🫡', '💀',
];

/** Autocomplete candidates for a shortcode query, best matches first.
 * Substring match (ui_nits): "fire" finds :campfire:-style names too; codes
 * that start with the query rank ahead of mid-name hits. */
export function emojiMatches(query: string, limit = 8): { code: string; emoji: string }[] {
  const lower = query.toLowerCase();
  if (!lower) return [];
  const rank = (code: string) => (code.startsWith(lower) ? 0 : 1);
  return Object.entries(EMOJI_SHORTCODES)
    .filter(([code]) => code.includes(lower))
    .sort(([a], [b]) => (rank(a) - rank(b)) || (a.length - b.length) || a.localeCompare(b))
    .slice(0, limit)
    .map(([code, emoji]) => ({ code, emoji }));
}

/** Expands `:shortcode:` tokens to unicode (unknown codes left untouched). */
export function expandShortcodes(text: string): string {
  if (!text.includes(':')) return text;
  return text.replace(/:([a-zA-Z0-9_+-]+):/g, (raw, code: string) => EMOJI_SHORTCODES[code.toLowerCase()] ?? raw);
}
