/**
 * Lines for the results message. {name} is replaced with the player.
 * Cheeky, never nasty - these land in a group chat with everyone in it.
 */

export const WINNER_LINES = [
  "🏆 All hail *{name}*, ruler of the glass walls. Drinks are on you, champ.",
  "👑 *{name}* came, saw, and smashed. Absolutely nobody is surprised (except {name}).",
  "🔥 *{name}* was on fire today. Someone check the court for scorch marks.",
  "🎯 *{name}* didn't miss. Not once. Suspicious, honestly - we're checking the racket.",
  "🥇 Bow down to *{name}*. Autographs available after the cool-down.",
  "🚀 *{name}* played like the rent was due. Take a bow.",
  "💪 *{name}* - top of the table and insufferable about it until next week. Earned it.",
  "🐐 Is *{name}* the GOAT? The leaderboard says yes. The group chat will now argue.",
  "⚡ *{name}* had the kind of day pros write books about. Well played!",
  "🍾 Pop the bubbly - *{name}* has conquered the Americano!",
  "🧠 *{name}* played 4D padel while the rest of us played checkers. Respect.",
  "🦁 *{name}* hunted every loose ball like it owed them money. Champion!",
  "🎉 Massive congrats *{name}* - your partners thank you for carrying them.",
];

export const LOSER_LINES = [
  "🥄 Wooden spoon goes to *{name}*. It's not about winning... is what we'll keep telling you.",
  "🧱 *{name}* found the glass more often than the ball today. Next week's yours, probably.",
  "🐢 *{name}* was playing the long game. Very long. Still loading.",
  "🎈 *{name}* brought the vibes, just not the points. Vibes matter too ❤️",
  "🧘 *{name}* was practising mindfulness: present in the moment, absent from the scoreboard.",
  "📉 *{name}*'s stock is low - buy now, it can only go up from here.",
  "🙈 *{name}*, the net called. It wants its ball back. All of them.",
  "🦆 *{name}* is quacking under pressure. Lessons are available, we hear.",
  "🛋️ *{name}* treated the court like a lounge today. Comfy? Good. Now train.",
  "🍀 *{name}*, luck was not on your side. Neither were the points. Or the lobs.",
  "🧳 *{name}* came for the cardio and the snacks. Mission accomplished.",
  "🤝 Big thanks to *{name}* for making everyone else look good today. True team player.",
  "🐌 *{name}*'s comeback is going to be legendary. Any week now.",
];

export function pick<T>(lines: T[], random: () => number = Math.random): T {
  return lines[Math.floor(random() * lines.length)];
}
