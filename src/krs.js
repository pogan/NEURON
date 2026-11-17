import { config } from './config.js';
import { consume } from './quota.js';

/**
 * Klient Otwartego API KRS (https://prs.ms.gov.pl/krs/openApi), bez klucza.
 * Odpis da się pobrać tylko po numerze KRS i rejestrze (P — przedsiębiorcy, S — stowarzyszenia),
 * a dzienny biuletyn podaje numery podmiotów, w których tego dnia był wpis.
 */

export class KrsError extends Error {
  constructor(status, message) {
    super(message || `Błąd API KRS (HTTP ${status})`);
    this.status = status;
  }
}

async function krsGet(path, priority) {
  consume('krs', priority);
  const res = await fetch(config.krs.apiBase + path, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new KrsError(res.status);
  // Dla części numerów API odpowiada 200/204 bez treści — traktujemy jak brak odpisu.
  const text = await res.text();
  return text.trim() ? JSON.parse(text) : null;
}

export const padKrs = (n) => String(n).padStart(10, '0');

/** Numery KRS z biuletynu zmian danego dnia (bez powtórzeń, rosnąco). */
export async function bulletin(isoDay, priority = 'sync') {
  const list = (await krsGet(`/Krs/Biuletyn/${isoDay}`, priority)) || [];
  return [...new Set(list.map(padKrs))].sort();
}

/**
 * Odpis aktualny podmiotu: najpierw rejestr przedsiębiorców, potem stowarzyszeń.
 * null — brak odpisu aktualnego w obu (numer nieużyty albo podmiot wykreślony).
 */
export async function currentExtract(krs, priority = 'sync') {
  for (const register of ['P', 'S']) {
    const data = await krsGet(`/krs/OdpisAktualny/${padKrs(krs)}?rejestr=${register}&format=json`, priority);
    if (data?.odpis) return data.odpis;
  }
  return null;
}
