/** Short shareable lobby codes. Ambiguous characters (0/O, 1/I) are omitted. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LOBBY_CODE_LENGTH = 6;

export function normalizeLobbyCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LOBBY_CODE_LENGTH);
}

export function isLobbyCode(raw: string): boolean {
  const code = normalizeLobbyCode(raw);
  return code.length === LOBBY_CODE_LENGTH;
}

export function randomLobbyCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)]!;
  }
  return out;
}
