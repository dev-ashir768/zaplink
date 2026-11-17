/**
 * Up to two initials for an avatar: the first letter of the first two words, or the first two letters of a
 * single word. Splits by code point so an emoji or a surrogate-pair letter is never cut in half.
 */
export function userInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/u)
    .filter(Boolean);
  if (words.length === 0) return '';
  const first = Array.from(words[0]);
  const letters = words.length > 1 ? [first[0], Array.from(words[1])[0]] : first.slice(0, 2);
  return letters.join('').toLocaleUpperCase();
}
