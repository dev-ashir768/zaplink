import { searchTermCount } from './search-terms';

const chars = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

describe('searchTermCount', () => {
  it('counts a run of letters or digits as one word and ASCII punctuation as a separator', () => {
    expect(searchTermCount('hello')).toBe(1);
    expect(searchTermCount('hello world')).toBe(2);
    expect(searchTermCount('a.b.c')).toBe(3);
    expect(searchTermCount('user@example.com')).toBe(3);
    expect(searchTermCount('2024-10-14')).toBe(3);
  });

  it('counts a whitespace-separated word said again once', () => {
    expect(searchTermCount('hi hi hi')).toBe(1);
    expect(searchTermCount('a.b a.b')).toBe(2);
  });

  it('counts a word with no letter or digit as one', () => {
    expect(searchTermCount('!!!')).toBe(1);
  });

  it('keeps the words of non-Latin text whole', () => {
    expect(searchTermCount('привет мир')).toBe(2);
    expect(searchTermCount('こんにちは')).toBe(1);
  });

  it('keeps an ordinary sentence of a script with vowel signs and joiners under the 32-word limit', () => {
    // Combining marks and joiners between letters add no word, as the index splits on them too.
    expect(searchTermCount('मैं आज शाम को बाज़ार जाकर कुछ ताज़ी सब्ज़ियाँ और फल खरीदूँगा')).toBeLessThanOrEqual(32);
    expect(searchTermCount('نمی\u200Cخواهم')).toBe(2);
    expect(searchTermCount('క్రమం తెలుగు')).toBeLessThanOrEqual(8);
    // A mark or a symbol that stands alone, or a run of them, still counts.
    expect(searchTermCount(chars(0x0301))).toBe(1);
    expect(searchTermCount(chars(0x1f923).repeat(10))).toBe(5);
    expect(searchTermCount(`${chars(0x1f923)}${chars(0xb7)}`.repeat(10))).toBe(10);
  });

  it('counts a character the index may split on, or glue, one by one', () => {
    // A letter its tokenizer still splits on, a private-use character and an emoji its Unicode table
    // predates: each is a word of its own between separators or next to a letter.
    for (const c of [chars(0x1cf2), chars(0xe000), chars(0x1f923), chars(0x1f3fb)]) {
      expect(searchTermCount(`${c}.`.repeat(40))).toBeGreaterThanOrEqual(40);
      expect(searchTermCount(`a${c}`.repeat(40))).toBeGreaterThanOrEqual(40);
    }
  });
});
