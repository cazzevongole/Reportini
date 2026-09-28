const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const MESI = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

export function maiuscola(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function dataLunga(iso: string): string {
  const data = new Date(iso);
  return `${GIORNI[data.getDay()]} ${data.getDate()} ${MESI[data.getMonth()]}`;
}

export function dataBreve(iso: string): string {
  const data = new Date(iso);
  return `${data.getDate()} ${MESI[data.getMonth()].slice(0, 3)}`;
}

export function ora(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function intervallo(inizio: string, fine: string): string {
  return `${ora(inizio)} – ${ora(fine)}`;
}

export function durata(inizio: string, fine: string): string {
  const minuti = Math.round((new Date(fine).getTime() - new Date(inizio).getTime()) / 60000);
  if (minuti < 60) return `${minuti} min`;
  const ore = Math.floor(minuti / 60);
  const resto = minuti % 60;
  return resto ? `${ore} h ${resto} min` : `${ore} h`;
}

export function relativo(iso: string): string {
  const differenza = new Date(iso).getTime() - Date.now();
  const minuti = Math.round(differenza / 60000);
  if (minuti < 0) {
    const passati = Math.abs(minuti);
    if (passati < 60) return `${passati} min fa`;
    if (passati < 1440) return `${Math.round(passati / 60)} h fa`;
    return `${Math.round(passati / 1440)} g fa`;
  }
  if (minuti < 60) return `tra ${minuti} min`;
  if (minuti < 1440) return `tra ${Math.round(minuti / 60)} h`;
  if (minuti < 10080) return `tra ${Math.round(minuti / 1440)} g`;
  return `tra ${Math.round(minuti / 10080)} sett.`;
}

export function eta(dataNascita: string | null): string | null {
  if (!dataNascita) return null;
  const data = new Date(dataNascita);
  if (Number.isNaN(data.getTime())) return null;
  const oggi = new Date();
  let anni = oggi.getFullYear() - data.getFullYear();
  const mese = oggi.getMonth() - data.getMonth();
  if (mese < 0 || (mese === 0 && oggi.getDate() < data.getDate())) anni -= 1;
  return anni >= 0 ? `${anni} anni` : null;
}

/* ------------------------- helper per datetime-local ----------------------- */

/** Valore locale per <input type="datetime-local"> (nessuno spostamento UTC). */
export function aInputDateTime(iso: string): string {
  const data = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}T${pad(
    data.getHours(),
  )}:${pad(data.getMinutes())}`;
}

export function daInputDateTime(valore: string): string {
  return new Date(valore).toISOString();
}

export function aggiungiMinuti(iso: string, minuti: number): string {
  return new Date(new Date(iso).getTime() + minuti * 60000).toISOString();
}

export function inizioGiorno(data = new Date()): string {
  const copia = new Date(data);
  copia.setHours(0, 0, 0, 0);
  return copia.toISOString();
}

export function fineGiorno(data = new Date()): string {
  const copia = new Date(data);
  copia.setHours(23, 59, 59, 999);
  return copia.toISOString();
}

export function giornoISO(data: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;
}
