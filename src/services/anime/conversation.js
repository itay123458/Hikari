// Original, spoiler-free prompts. No provider requests, scraped text, or pings.
export const CONVERSATION_PROMPTS = Object.freeze([
  'Which anime hooked you in its very first episode? Share the title and a spoiler-free reason.',
  'What is your comfort anime—the one you return to when you want a good evening?',
  'Which anime opening or ending never leaves your playlist? Tell us what makes it memorable.',
  'You can spend a peaceful day in one anime setting. Where do you go, and what do you do?',
  'Which side character deserves their own series? Explain without revealing plot twists.',
  'What manga would you recommend to someone who mostly watches anime?',
  'Short series or long adventure: which fits your mood right now?',
  'What is an anime friendship you love, and what makes its dynamic work? Keep it spoiler-free.',
  'Choose an anime-night snack and a show to match it. What is your perfect pairing?',
  'Which animation style, background, or character design caught your eye recently?',
  'What is a genre you would like to try next? Let the palace suggest a starting point.',
  'What show on your planned-to-watch list are you most excited to finally start?',
  'What anime soundtrack helps you focus, relax, or get moving?',
  'Pitch your favorite anime in one sentence, without spoilers. Make us curious!',
]);

export const calendarDay = date => Date.parse(`${date}T00:00:00Z`) / 86400000;
