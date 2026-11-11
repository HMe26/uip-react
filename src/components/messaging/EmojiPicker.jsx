import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * WhatsApp-style emoji picker: category tabs, search (English + Arabic), "recent" row.
 * `onPick(emoji)` is called for each tap; the parent decides where to insert it.
 * `top` puts the category tabs above the grid (used inside the chat picker); otherwise they sit at the bottom.
 * One delegated click handler + memoised sections keep it instant even with ~1000 emoji.
 */
const CATS = [
  { id: 'smileys', icon: '😀', ar: 'وجوه ومشاعر', en: 'Smileys & Emotion', list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 🫠 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🫣 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 🤥 🫨 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙈 🙉 🙊 💋 💌 💘 💝 💖 💗 💓 💞 💕 💟 ❣️ 💔 ❤️‍🔥 ❤️‍🩹 ❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💯 💢 💥 💫 💦 💨 🕳️ 💬 🗯️ 💭 💤' },
  { id: 'people', icon: '👋', ar: 'ناس وإيدين', en: 'People & Body', list: '👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 🧑‍⚕️ 👨‍⚕️ 👩‍⚕️ 🧑‍🎓 👨‍🎓 👩‍🎓 🧑‍🏫 👨‍🏫 👩‍🏫 🧑‍💻 👨‍💻 👩‍💻 🧑‍🔧 👨‍🔧 🧑‍🍳 🧑‍🚀 🧑‍🚒 👮 🕵️ 💂 🥷 👷 🤴 👸 👳 👲 🧕 🤵 👰 🤰 🫄 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 🕴️ 👯 🧖 🧘 🛀 🛌 👭 👫 👬 💏 💑 👪 👣' },
  { id: 'nature', icon: '🐱', ar: 'حيوانات وطبيعة', en: 'Animals & Nature', list: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐽 🐸 🐵 🐔 🐧 🐦 🐤 🐣 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🪰 🪲 🦟 🦗 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🐈 🐈‍⬛ 🐓 🦃 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🪵 🌱 🌿 ☘️ 🍀 🎍 🪴 🎋 🍃 🍂 🍁 🍄 🐚 🪨 🌾 💐 🌷 🌹 🥀 🪻 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌖 🌗 🌘 🌑 🌒 🌓 🌔 🌙 🌎 🌍 🌏 🪐 💫 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌪️ 🌈 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 💧 💦 ☔ 🌊' },
  { id: 'food', icon: '🍕', ar: 'أكل وشرب', en: 'Food & Drink', list: '🍇 🍈 🍉 🍊 🍋 🍌 🍍 🥭 🍎 🍏 🍐 🍑 🍒 🍓 🫐 🥝 🍅 🫒 🥥 🥑 🍆 🥔 🥕 🌽 🌶️ 🫑 🥒 🥬 🥦 🧄 🧅 🍄 🥜 🫘 🌰 🍞 🥐 🥖 🫓 🥨 🥯 🥞 🧇 🧀 🍖 🍗 🥩 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🫔 🥙 🧆 🥚 🍳 🥘 🍲 🫕 🥣 🥗 🍿 🧈 🧂 🥫 🍱 🍘 🍙 🍚 🍛 🍜 🍝 🍠 🍢 🍣 🍤 🍥 🥮 🍡 🥟 🥠 🥡 🦀 🦞 🦐 🦑 🦪 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🥧 🍫 🍬 🍭 🍮 🍯 🍼 🥛 ☕ 🫖 🍵 🍶 🍾 🍷 🍸 🍹 🍺 🍻 🥂 🥃 🫗 🥤 🧋 🧃 🧉 🧊 🥢 🍽️ 🍴 🥄' },
  { id: 'travel', icon: '🚗', ar: 'سفر وأماكن', en: 'Travel & Places', list: '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🏍️ 🛵 🚲 🛴 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ ⛽ 🚧 🚦 🚥 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🏠 🏡 🏘️ 🏚️ 🏗️ 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋 ⛩️ 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙️ 🌃 🌌 🌉 🌁' },
  { id: 'activity', icon: '⚽', ar: 'أنشطة ورياضة', en: 'Activities', list: '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏋️ 🤼 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚵 🚴 🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🪘 🎷 🎺 🪗 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩 🎉 🎊 🎁 🎈 🎀 🪅 🪩' },
  { id: 'objects', icon: '💡', ar: 'أشياء', en: 'Objects', list: '⌚ 📱 📲 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯️ 🪔 🧯 🛢️ 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🪤 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🕳️ 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🧺 🧻 🚽 🚰 🚿 🛁 🧼 🪥 🪒 🧽 🪣 🧴 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🧸 🪆 🖼️ 🛍️ 🛒 🎁 🎈 🎏 🎀 🎊 🎉 ✉️ 📩 📨 📧 💌 📥 📤 📦 🏷️ 📪 📫 📬 📭 📮 📯 📜 📃 📄 📑 🧾 📊 📈 📉 🗒️ 🗓️ 📆 📅 🗑️ 📇 🗃️ 🗳️ 🗄️ 📋 📁 📂 🗂️ 🗞️ 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓' },
  { id: 'symbols', icon: '🔣', ar: 'رموز', en: 'Symbols', list: '☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿ 🅿️ 🛗 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 ⚧️ 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ⏏️ ▶️ ⏸️ ⏯️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ ♾️ 💲 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 🔜 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾ ◽ ◼️ ◻️ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 💬 💭 🗯️ ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛' },
  { id: 'flags', icon: '🏁', ar: 'أعلام', en: 'Flags', list: '🏁 🚩 🎌 🏴 🏳️ 🏳️‍🌈 🏳️‍⚧️ 🏴‍☠️ 🇪🇬 🇸🇦 🇦🇪 🇶🇦 🇰🇼 🇧🇭 🇴🇲 🇯🇴 🇱🇧 🇸🇾 🇮🇶 🇵🇸 🇾🇪 🇱🇾 🇹🇳 🇩🇿 🇲🇦 🇸🇩 🇸🇴 🇲🇷 🇹🇷 🇮🇷 🇺🇸 🇬🇧 🇨🇦 🇫🇷 🇩🇪 🇮🇹 🇪🇸 🇵🇹 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇷🇺 🇺🇦 🇵🇱 🇬🇷 🇨🇳 🇯🇵 🇰🇷 🇮🇳 🇵🇰 🇧🇩 🇮🇩 🇲🇾 🇸🇬 🇹🇭 🇻🇳 🇵🇭 🇦🇺 🇳🇿 🇧🇷 🇦🇷 🇲🇽 🇨🇴 🇨🇱 🇿🇦 🇳🇬 🇰🇪 🇪🇹 🇬🇭' },
];

// Bilingual search keywords — enough for the common emoji without shipping a full CLDR dataset.
const KEYWORDS = {
  '😀': 'grin smile happy ابتسامة سعيد', '😃': 'smile happy سعيد', '😄': 'smile happy joy فرحان', '😁': 'grin beam اسنان', '😆': 'laugh squint ضحك', '😅': 'sweat nervous relief عرق توتر',
  '😂': 'laugh funny lol tears joy ضحك بموت', '🤣': 'laugh rofl rolling ضحك هيستيري', '🙂': 'slight smile ابتسامة خفيفة', '🙃': 'upside down مقلوب', '😉': 'wink غمزة', '😊': 'blush smile خجول',
  '😇': 'angel halo ملاك', '🥰': 'love cute hearts حب', '😍': 'love heart eyes حب عيون قلوب', '🤩': 'star struck wow نجوم', '😘': 'kiss بوسة', '😋': 'yum tasty delicious لذيذ', '😜': 'wink tongue مجنون',
  '🤗': 'hug عناق حضن', '🤔': 'think hmm تفكير', '🤨': 'raised eyebrow شك', '😐': 'neutral محايد', '😑': 'expressionless', '😶': 'silent speechless صامت', '😏': 'smirk', '😒': 'unamused ملل',
  '🙄': 'eye roll ملل', '😬': 'grimace', '😌': 'relieved راحة', '😔': 'sad pensive حزين', '😴': 'sleep tired نوم', '😷': 'mask sick مريض كمامة', '🤒': 'sick fever مريض حرارة', '🤢': 'nauseated sick',
  '🤮': 'vomit', '🥵': 'hot سخن', '🥶': 'cold freezing برد', '🤯': 'mind blown exploding', '🥳': 'party celebrate birthday احتفال', '😎': 'cool sunglasses نظارة', '🤓': 'nerd', '😕': 'confused',
  '😮': 'wow surprised مندهش', '😲': 'astonished shock', '😳': 'flushed embarrassed', '🥺': 'plead puppy eyes please رجاء', '😢': 'sad cry حزين بكاء', '😭': 'cry sob loud بكاء', '😱': 'scream scared shock خوف',
  '😡': 'angry mad rage غضب', '😠': 'angry غضبان', '🤬': 'cursing swearing شتيمة', '😈': 'devil evil شيطان', '💀': 'skull dead death جمجمة', '💩': 'poop caca', '🤡': 'clown مهرج', '👻': 'ghost شبح',
  '👽': 'alien', '🤖': 'robot روبوت', '🙈': 'see no evil monkey قرد', '💋': 'kiss lips بوسة', '💘': 'love arrow cupid', '❤️': 'heart love red قلب حب', '🧡': 'orange heart', '💛': 'yellow heart',
  '💚': 'green heart', '💙': 'blue heart', '💜': 'purple heart', '🖤': 'black heart', '🤍': 'white heart', '💔': 'broken heart قلب مكسور', '💕': 'two hearts', '💯': 'hundred 100 perfect مية',
  '💥': 'boom collision', '💫': 'dizzy', '💦': 'sweat water drops', '💬': 'speech chat كلام', '💤': 'zzz sleep',
  '👋': 'wave hello hi bye مرحبا سلام', '🤚': 'raised back hand', '✋': 'stop hand high five', '👌': 'ok perfect تمام', '🤌': 'pinched italian', '✌️': 'victory peace v', '🤞': 'fingers crossed good luck',
  '🤟': 'love you', '🤘': 'rock horns', '🤙': 'call me shaka', '👈': 'point left', '👉': 'point right', '👆': 'point up', '👇': 'point down', '👍': 'thumbs up like yes ok تمام اعجاب',
  '👎': 'thumbs down dislike no لا', '✊': 'fist', '👊': 'punch fist bump', '👏': 'clap bravo applause تصفيق', '🙌': 'raise hands celebrate', '🤝': 'handshake deal اتفاق', '🙏': 'pray thanks please folded hands شكرا دعاء',
  '✍️': 'write', '💪': 'strong muscle flex قوة', '🧠': 'brain mind مخ', '👀': 'eyes look عيون', '👅': 'tongue', '👶': 'baby طفل', '🤷': 'shrug معرفش', '🤦': 'facepalm', '🙋': 'raise hand',
  '🐶': 'dog كلب', '🐱': 'cat قطة', '🐭': 'mouse', '🐰': 'rabbit', '🦊': 'fox', '🐻': 'bear دب', '🐼': 'panda', '🦁': 'lion أسد', '🐯': 'tiger', '🐸': 'frog ضفدع', '🐵': 'monkey', '🐔': 'chicken',
  '🦄': 'unicorn', '🐝': 'bee نحلة', '🦋': 'butterfly فراشة', '🐢': 'turtle سلحفاة', '🐍': 'snake ثعبان', '🐙': 'octopus', '🐬': 'dolphin', '🐳': 'whale حوت', '🐘': 'elephant فيل', '🐪': 'camel جمل',
  '🌹': 'rose flower وردة', '🌸': 'blossom flower', '🌻': 'sunflower', '🌞': 'sun شمس', '🌙': 'moon قمر', '⭐': 'star نجمة', '🌟': 'glowing star', '✨': 'sparkles', '⚡': 'lightning بنزين', '🔥': 'fire hot نار',
  '🌈': 'rainbow قوس قزح', '☁️': 'cloud سحابة', '❄️': 'snow cold', '💧': 'water drop ميه', '🌊': 'wave sea موجة',
  '🍎': 'apple تفاحة', '🍌': 'banana موز', '🍉': 'watermelon بطيخ', '🍓': 'strawberry فراولة', '🍕': 'pizza بيتزا', '🍔': 'burger برجر', '🍟': 'fries بطاطس', '🌮': 'taco', '🍣': 'sushi', '🍦': 'ice cream ايس كريم',
  '🍩': 'donut', '🍪': 'cookie بسكوت', '🎂': 'cake birthday تورتة', '🍰': 'cake', '🍫': 'chocolate شوكولاتة', '☕': 'coffee قهوة', '🍵': 'tea شاي', '🥤': 'drink', '🍺': 'beer',
  '⚽': 'football soccer كورة', '🏀': 'basketball', '🎮': 'game controller العاب', '🎯': 'target bullseye', '🎲': 'dice', '🎧': 'headphones سماعة', '🎤': 'microphone ميكروفون', '🎸': 'guitar جيتار', '🏆': 'trophy كاس',
  '🥇': 'gold medal first', '🎉': 'party celebrate tada مبروك احتفال', '🎊': 'confetti', '🎁': 'gift present هدية', '🎈': 'balloon بالون',
  '🚗': 'car عربية', '✈️': 'airplane plane طيارة', '🚀': 'rocket launch صاروخ', '🏠': 'home house بيت', '🏫': 'school مدرسة', '🏥': 'hospital مستشفى',
  '📱': 'phone mobile موبايل', '💻': 'laptop computer لابتوب', '⌨️': 'keyboard', '📷': 'camera كاميرا', '📞': 'phone call', '⏰': 'alarm clock منبه', '🔋': 'battery بطارية', '💡': 'idea bulb فكرة',
  '📚': 'books study كتب مذاكرة', '📖': 'book read', '📝': 'note write كتابة', '✏️': 'pencil', '📎': 'paperclip', '📌': 'pin', '📍': 'location pin مكان', '📊': 'chart bar', '📈': 'chart up increase', '📉': 'chart down',
  '💰': 'money bag فلوس', '💳': 'credit card', '💎': 'gem diamond', '🔧': 'wrench tool', '🔨': 'hammer', '⚙️': 'gear settings', '🔑': 'key مفتاح', '🔒': 'lock قفل', '🔓': 'unlock', '🔔': 'bell notification', '🔕': 'mute bell',
  '✅': 'done check tick تم صح', '❌': 'no wrong cross x خطأ', '❗': 'exclamation', '❓': 'question سؤال', '⚠️': 'warning تحذير', '🚫': 'prohibited forbidden ممنوع', '🇪🇬': 'egypt مصر', '🇸🇦': 'saudi arabia السعودية',
};

export const EMOJI_CATS = CATS.map((c) => ({ ...c, items: c.list.split(/\s+/).filter(Boolean) }));
const ALL = EMOJI_CATS;
const ALL_FLAT = (() => { const seen = new Set(); const out = []; ALL.forEach((c) => c.items.forEach((e) => { if (!seen.has(e)) { seen.add(e); out.push(e); } })); return out; })();

const RECENT_KEY = 'uip_emoji_recent';
const MAX_RECENT = 32;
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, MAX_RECENT); } catch { return []; } };

const Grid = memo(function Grid({ list }) {
  return (
    <div className="emo-grid">
      {list.map((e, i) => <button type="button" key={`${e}-${i}`} className="emo-btn" data-e={e} tabIndex={-1}>{e}</button>)}
    </div>
  );
});

const ROW_PX = 36; // one emoji row (button height + gap), used to size not-yet-mounted sections so the scrollbar stays honest

const Section = memo(function Section({ cat, title, setRef, live }) {
  return (
    <section className="emo-section" data-cat={cat.id} ref={setRef} style={live ? undefined : { minHeight: Math.ceil(cat.items.length / 8) * ROW_PX + 34 }}>
      <h4 className="emo-title">{title}</h4>
      {live ? <Grid list={cat.items} /> : null}
    </section>
  );
});

const idle = (fn) => (typeof window.requestIdleCallback === 'function'
  ? window.requestIdleCallback(fn, { timeout: 400 })
  : window.setTimeout(fn, 60));
const cancelIdle = (id) => (typeof window.cancelIdleCallback === 'function' ? window.cancelIdleCallback(id) : window.clearTimeout(id));
const MAX_RESULTS = 160;

export default function EmojiPicker({ onPick, onClose, ar, top = false, autoFocus = false }) {
  const [tab, setTab] = useState(() => (readRecent().length ? 'recent' : 'smileys'));
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState(readRecent);
  const bodyRef = useRef(null);
  const sectionRefs = useRef({});
  const refSetters = useRef({});
  const lock = useRef(0);
  const pendingJump = useRef(null);
  // Only the first sections are built up front (the full set is ~1000 colour glyphs); the rest are mounted one by one
  // while the browser is idle, or immediately when a tab is clicked. Opening the picker stays instant.
  const [mounted, setMounted] = useState(2);
  // stable ref callbacks: a new arrow function per render would defeat memo() and re-render every section on each tap/scroll
  const refFor = useCallback((id) => {
    if (!refSetters.current[id]) refSetters.current[id] = (el) => { sectionRefs.current[id] = el; };
    return refSetters.current[id];
  }, []);

  useEffect(() => {
    if (mounted >= ALL.length) return undefined;
    const h = idle(() => setMounted((m) => Math.min(ALL.length, m + 1)));
    return () => cancelIdle(h);
  }, [mounted]);

  const pick = useCallback((e) => {
    onPick(e);
    setRecent((cur) => {
      const next = [e, ...cur.filter((x) => x !== e)].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
      return next;
    });
  }, [onPick]);

  const onBodyClick = (ev) => {
    const el = ev.target.closest?.('[data-e]');
    if (el) pick(el.getAttribute('data-e'));
  };

  const dq = useDeferredValue(q); // typing stays responsive; the filtered grid catches up right after
  const results = useMemo(() => {
    const term = dq.trim().toLowerCase();
    if (!term) return null;
    return ALL_FLAT.filter((e) => e === term || (KEYWORDS[e] || '').toLowerCase().includes(term)).slice(0, MAX_RESULTS);
  }, [dq]);

  const scrollToSection = (id) => {
    const box = bodyRef.current;
    if (!box) return;
    if (id === 'recent') { box.scrollTo({ top: 0 }); return; }
    const el = sectionRefs.current[id];
    if (el) box.scrollTo({ top: box.scrollTop + (el.getBoundingClientRect().top - box.getBoundingClientRect().top) - 2 });
  };
  const jump = (id) => {
    setTab(id);
    setQ('');
    lock.current = Date.now();
    const idx = ALL.findIndex((c) => c.id === id);
    if (idx >= mounted) {
      // make sure everything above the target is built before measuring where to scroll
      pendingJump.current = id;
      setMounted(idx + 1);
      return;
    }
    requestAnimationFrame(() => scrollToSection(id));
  };
  useLayoutEffect(() => {
    if (!pendingJump.current) return;
    const id = pendingJump.current;
    pendingJump.current = null;
    scrollToSection(id);
  }, [mounted]);

  // highlight the tab of the section currently in view (ignored briefly after a tab click)
  useEffect(() => {
    const box = bodyRef.current;
    if (!box || results) return undefined;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (Date.now() - lock.current < 350) return;
        let current = recent.length && box.scrollTop < 40 ? 'recent' : ALL[0].id;
        ALL.forEach((c) => {
          const el = sectionRefs.current[c.id];
          if (el && el.getBoundingClientRect().top - box.getBoundingClientRect().top <= 24) current = c.id;
        });
        setTab(current);
      });
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => { box.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [results, recent.length]);

  const tabsEl = (
    <div className={`emo-tabs${top ? ' emo-tabs--top' : ''}`} role="tablist">
      {recent.length > 0 && (
        <button type="button" role="tab" aria-selected={tab === 'recent' && !results} className={`emo-tab emo-tab--svg${tab === 'recent' && !results ? ' is-on' : ''}`} onClick={() => jump('recent')} title={ar ? 'الأحدث' : 'Recent'}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        </button>
      )}
      {ALL.map((c) => (
        <button type="button" role="tab" aria-selected={tab === c.id && !results} key={c.id} className={`emo-tab${tab === c.id && !results ? ' is-on' : ''}`} onClick={() => jump(c.id)} title={ar ? c.ar : c.en}>{c.icon}</button>
      ))}
    </div>
  );

  return (
    <div className={`emo-picker${top ? ' emo-picker--wa' : ''}`} role="dialog" aria-label={ar ? 'اختيار إيموجي' : 'Emoji picker'}>
      {top && tabsEl}
      <div className="emo-search">
        <svg className="emo-search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          type="search"
          value={q}
          autoFocus={autoFocus && !(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'ابحث عن إيموجي (قلب، ضحك، love)' : 'Search emoji (love, laugh, قلب)'}
          dir="auto"
        />
        {onClose && !top && <button type="button" className="emo-close" aria-label={ar ? 'إغلاق' : 'Close'} onClick={onClose}>×</button>}
      </div>
      <div className="emo-body" ref={bodyRef} onClick={onBodyClick}>
        {results ? (
          results.length ? <Grid list={results} /> : <p className="emo-empty">{ar ? 'مفيش نتائج' : 'No emoji found'}</p>
        ) : (
          <>
            {recent.length > 0 && (
              <section className="emo-section" data-cat="recent">
                <h4 className="emo-title">{ar ? 'الأحدث استخدامًا' : 'Recent'}</h4>
                <Grid list={recent} />
              </section>
            )}
            {ALL.map((c, i) => <Section key={c.id} cat={c} title={ar ? c.ar : c.en} setRef={refFor(c.id)} live={i < mounted} />)}
          </>
        )}
      </div>
      {!top && tabsEl}
    </div>
  );
}
