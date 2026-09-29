// Genera le icone dell'app da un solo disegno, così i formati non possono
// divergere: la PNG per Linux e per electron-builder, la .ico per Windows, la
// .icns per la macOS, più le due PNG che il manifest web chiede.
//
//   node scripts/icona.mjs
//
// Il disegno è una funzione di distanza con le figure dell'app — il foglio di
// anagrafiche e l'orologio — quindi viene rasterizzato con l'anti-alias
// esatto (copertura = 0.5 - distanza) e i formati sono scritti a mano su
// zlib. Nessuna dipendenza e nessuna rete: funziona anche su una macchina
// appena clonata, che è anche il caso in cui si rimette a posto un'icona.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------- geometria

/** Distanza con segno da un rettangolo dagli angoli tondi. */
function sdRett(x, y, { x0, y0, x1, y1 }, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - (x1 - x0) / 2 + r;
  const qy = Math.abs(y - cy) - (y1 - y0) / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distanza con segno da un segmento spesso: i tasti tondi escono da soli. */
function sdSegmento(x, y, ax, ay, bx, by, r) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

function sdCircolo(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

// I colori sono quelli del tema e del favicon: blu notte, carta, verde e
// arancione. Restano leggibili in bianco e nero e a 16 pixel, che è la
// dimensione più piccola in cui l'icona si vede davvero (le liste di file).
const NOTTE_A = [0x36, 0x3e, 0x59];
const NOTTE_B = [0x16, 0x1a, 0x25];
const CARTA = [0xf7, 0xf6, 0xf2];
const VERDE = [0x12, 0xb3, 0x94];
const ARANCIO = [0xdc, 0x6f, 0x47];
const GRIZIO = [0x4a, 0x54, 0x68];

// Il foglio e l'orologio, in un riquadro da 1024. Le misure sono scelte perché
// a 16 pixel restino tre strisce spesse e un disco: le cifre minute sparirebbero.
const FOGLIO = { x0: 170, y0: 195, x1: 665, y1: 815 };
const SPAZIO = { x0: FOGLIO.x0 + 65, y0: 425, x1: FOGLIO.x1 - 65 };
const OROLOGIO = { x: 705, y: 720, r: 170 };

// Centrare il disegno sul riquadro, calcolandolo invece di indovinarlo: basta
// l'unione delle due figure principali, così il resto non va riallineato a mano
// quando una misura cambia.
const INGREZZO = {
  x0: Math.min(FOGLIO.x0, OROLOGIO.x - OROLOGIO.r - 20),
  y0: Math.min(FOGLIO.y0, OROLOGIO.y - OROLOGIO.r - 20),
  x1: Math.max(FOGLIO.x1, OROLOGIO.x + OROLOGIO.r + 20),
  y1: Math.max(FOGLIO.y1, OROLOGIO.y + OROLOGIO.r + 20),
};
const SCARTO = {
  x: 512 - (INGREZZO.x0 + INGREZZO.x1) / 2,
  y: 512 - (INGREZZO.y0 + INGREZZO.y1) / 2,
};

/** Scala la cornice di una figura attorno al centro del riquadro. */
function centra(forma) {
  return {
    x0: forma.x0 + SCARTO.x,
    y0: forma.y0 + SCARTO.y,
    x1: forma.x1 + SCARTO.x,
    y1: forma.y1 + SCARTO.y,
  };
}

const sfondo = centra({ x0: 0, y0: 0, x1: 1024, y1: 1024 });
const foglio = centra(FOGLIO);
const spazio = centra(SPAZIO);

// Il disegno, in ordine di profondità. Ogni figura sa dire quanto è lontana
// dal punto: è quella distanza che dà il bordo morbido.
const FIGURE = [
  {
    // Il fondo è lo squircle scuro con un chiaro in alto a sinistra: dice "finestra
    // di un'app" meglio di un rettangolo pieno, e stacca dalla pagina bianca.
    sdf: (x, y) => sdRett(x, y, sfondo, 226),
    colore: (x, y) => {
      const t = Math.max(0, Math.min(1, (x / 1024) * 0.45 + (y / 1024) * 0.55));
      return NOTTE_A.map((a, i) => Math.round(a + (NOTTE_B[i] - a) * t));
    },
    scatola: sfondo,
  },
  {
    // L'ombra del foglio: senza, la carta sembra stampata sul fondo.
    sdf: (x, y) => sdRett(x, y - 18, foglio, 54),
    colore: () => [0x00, 0x00, 0x00],
    alfa: 0.3,
    scatola: { ...foglio, y1: foglio.y1 + 18 },
  },
  {
    sdf: (x, y) => sdRett(x, y, foglio, 46),
    colore: () => CARTA,
    scatola: foglio,
  },
  {
    // La fascia verde in testa: è il "colore dell'app" e spiega a colpo d'occhio
    // che il foglio è un registro, non una pagina qualunque.
    sdf: (x, y) =>
      Math.min(
        sdRett(x, y, { ...foglio, y1: foglio.y0 + 130 }, 46),
        sdRett(x, y, { ...foglio, y0: foglio.y0 + 100, y1: foglio.y0 + 130 }, 0),
      ),
    colore: () => VERDE,
    scatola: { ...foglio, y1: foglio.y0 + 130 },
  },
  // Righe spesse a scalare: è la parte che sparisce per prima, e a 16 pixel è
  // anche l'unica cosa che fa capire che il foglio ha del testo sopra. Le
  // larghezze scendono come in un registro vero, e l'ultima riempie il vuoto
  // sotto le altre senza finire sotto l'orologio.
  ...[365, 365, 250, 180].map((lunghezza, riga) => ({
    sdf: (x, y) =>
      sdSegmento(
        x,
        y,
        spazio.x0,
        spazio.y0 + riga * 90,
        spazio.x0 + lunghezza,
        spazio.y0 + riga * 90,
        30,
      ),
    colore: () => GRIZIO,
    scatola: {
      x0: spazio.x0 - 32,
      y0: spazio.y0 + riga * 90 - 32,
      x1: spazio.x0 + lunghezza + 32,
      y1: spazio.y0 + riga * 90 + 32,
    },
  })),
  {
    // L'anello di carta sotto il disco: stacca l'orologio dal foglio senza
    // dover fare un'ombra.
    sdf: (x, y) => sdCircolo(x, y, OROLOGIO.x + SCARTO.x, OROLOGIO.y + SCARTO.y, OROLOGIO.r + 20),
    colore: () => CARTA,
    scatola: {
      x0: OROLOGIO.x - OROLOGIO.r - 20 + SCARTO.x,
      y0: OROLOGIO.y - OROLOGIO.r - 20 + SCARTO.y,
      x1: OROLOGIO.x + OROLOGIO.r + 20 + SCARTO.x,
      y1: OROLOGIO.y + OROLOGIO.r + 20 + SCARTO.y,
    },
  },
  {
    sdf: (x, y) => sdCircolo(x, y, OROLOGIO.x + SCARTO.x, OROLOGIO.y + SCARTO.y, OROLOGIO.r),
    colore: () => ARANCIO,
    scatola: {
      x0: OROLOGIO.x - OROLOGIO.r + SCARTO.x,
      y0: OROLOGIO.y - OROLOGIO.r + SCARTO.y,
      x1: OROLOGIO.x + OROLOGIO.r + SCARTO.x,
      y1: OROLOGIO.y + OROLOGIO.r + SCARTO.y,
    },
  },
  {
    // Due lancette a dodici e a tre: a 16 pixel si vede la L, che è quello che
    // serve per capire "orologio" senza disegnare un quadrante.
    sdf: (x, y) =>
      Math.min(
        sdSegmento(
          x,
          y,
          OROLOGIO.x + SCARTO.x,
          OROLOGIO.y + SCARTO.y,
          OROLOGIO.x + SCARTO.x,
          OROLOGIO.y - 66 + SCARTO.y,
          21,
        ),
        sdSegmento(
          x,
          y,
          OROLOGIO.x + SCARTO.x,
          OROLOGIO.y + SCARTO.y,
          OROLOGIO.x + 68 + SCARTO.x,
          OROLOGIO.y + SCARTO.y,
          21,
        ),
      ),
    colore: () => CARTA,
    scatola: {
      x0: OROLOGIO.x - OROLOGIO.r + SCARTO.x,
      y0: OROLOGIO.y - OROLOGIO.r + SCARTO.y,
      x1: OROLOGIO.x + OROLOGIO.r + SCARTO.x,
      y1: OROLOGIO.y + OROLOGIO.r + SCARTO.y,
    },
  },
];

// ------------------------------------------------------------ rasterizzazione

/** Ridisegna il foglio a un lato qualsiasi, con mastro a 1024 e filtro a box. */
function ridisegna(lato) {
  const maestro = 1024;
  const sorgente = new Float64Array(maestro * maestro * 4);

  for (const figura of FIGURE) {
    const opacita = figura.alfa ?? 1;
    const x0 = Math.max(0, Math.floor(figura.scatola.x0 - 2));
    const y0 = Math.max(0, Math.floor(figura.scatola.y0 - 2));
    const x1 = Math.min(maestro - 1, Math.ceil(figura.scatola.x1 + 2));
    const y1 = Math.min(maestro - 1, Math.ceil(figura.scatola.y1 + 2));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // La copertura arriva dalla distanza con segno: mezzo pixel dentro è
        // pieno, mezzo fuori è vuoto, e il bordo resta liscio a ogni dimensione.
        const copertura = Math.max(0, Math.min(1, 0.5 - figura.sdf(x + 0.5, y + 0.5)));
        if (copertura === 0) continue;
        const a = copertura * opacita;
        const colore = figura.colore(x + 0.5, y + 0.5);
        const i = (y * maestro + x) * 4;
        const aFondo = sorgente[i + 3];
        const aNuovo = a + aFondo * (1 - a);
        for (let c = 0; c < 3; c++) {
          sorgente[i + c] = (colore[c] * a + sorgente[i + c] * aFondo * (1 - a)) / (aNuovo || 1);
        }
        sorgente[i + 3] = aNuovo;
      }
    }
  }

  // Il filtro a box è la media dei pixel coperti: è quello che tiene in piedi le
  // lancette a 32 pixel, che altrimenti diventerebbero una macchia.
  const risultato = Buffer.alloc(lato * lato * 4);
  const passo = maestro / lato;
  for (let y = 0; y < lato; y++) {
    for (let x = 0; x < lato; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = Math.floor(y * passo); sy < Math.ceil((y + 1) * passo); sy++) {
        for (let sx = Math.floor(x * passo); sx < Math.ceil((x + 1) * passo); sx++) {
          const i = (Math.min(maestro - 1, sy) * maestro + Math.min(maestro - 1, sx)) * 4;
          const peso = sorgente[i + 3];
          r += sorgente[i] * peso;
          g += sorgente[i + 1] * peso;
          b += sorgente[i + 2] * peso;
          a += peso;
          n++;
        }
      }
      const j = (y * lato + x) * 4;
      // Il colore si media pesato dall'opacità e si sblocca in alfa: così i
      // bordi arrotondati non restano con un alone scuro.
      const copertura = a / n;
      risultato[j] = Math.round(r / (a || 1));
      risultato[j + 1] = Math.round(g / (a || 1));
      risultato[j + 2] = Math.round(b / (a || 1));
      risultato[j + 3] = Math.round(copertura * 255);
    }
  }
  return risultato;
}

// ------------------------------------------------------------------ formati

function crc32(tamponi) {
  let crc = 0xffffffff;
  for (const byte of tamponi) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bloccoPNG(tipo, dati) {
  const lunghezza = Buffer.alloc(4);
  lunghezza.writeUInt32BE(dati.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), dati]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([lunghezza, corpo, crc]);
}

/** PNG RGBA a otto bit, compresso con la zlib di Node. */
function scriviPNG(rgba, lato) {
  const grezzi = Buffer.alloc(lato * (1 + lato * 4));
  for (let y = 0; y < lato; y++) {
    const inizio = y * (1 + lato * 4);
    grezzi[inizio] = 0; // filtro "None": qui non costa nulla e resta prevedibile
    rgba.copy(grezzi, inizio + 1, y * lato * 4, (y + 1) * lato * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lato, 0);
  ihdr.writeUInt32BE(lato, 4);
  ihdr[8] = 8; // bit per canale
  ihdr[9] = 6; // colore RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloccoPNG("IHDR", ihdr),
    bloccoPNG("IDAT", deflateSync(grezzi, { level: 9 })),
    bloccoPNG("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Immagine DIB per la .ico. La Windows 7 in avanti accetta anche PNG dentro una
 * .ico, ma solo per le voci da 256: per le piccole il BMP è la forma che
 * ogni sistema sa leggere, e la barra delle applicazioni su Windows 11 è
 * ancora il posto dove un'icona si vede male se il formato è strano.
 */
function scriviDIB(rgba, lato) {
  const intestazione = Buffer.alloc(40);
  const righe = lato * 4;
  intestazione.writeUInt32LE(40, 0);
  intestazione.writeInt32LE(lato, 4);
  intestazione.writeInt32LE(lato * 2, 8); // sotto sopra: XOR e AND insieme
  intestazione.writeUInt16LE(1, 12);
  intestazione.writeUInt16LE(32, 14);
  intestazione.writeUInt32LE(righe * lato + righe * Math.ceil(lato / 32) * 4, 20);

  const xor = Buffer.alloc(righe * lato);
  for (let y = 0; y < lato; y++) {
    for (let x = 0; x < lato; x++) {
      const sorgente = ((lato - 1 - y) * lato + x) * 4;
      const destinazione = (y * lato + x) * 4;
      xor[destinazione] = rgba[sorgente + 2];
      xor[destinazione + 1] = rgba[sorgente + 1];
      xor[destinazione + 2] = rgba[sorgente];
      xor[destinazione + 3] = rgba[sorgente + 3];
    }
  }
  // La maschera AND a un bit: tutto trasparente, perché l'alfa sta già nei
  // pixel. Va comunque scritta, o Explorer's Explorer non apre il file.
  const maschera = Buffer.alloc(righe * Math.ceil(lato / 32) * 4);
  return Buffer.concat([intestazione, xor, maschera]);
}

/** .ico con dentro tutte le dimensioni che Windows usa davvero. */
function scriviICO(immagini) {
  // La directory .ico ha un byte solo per la dimensione, quindi 256 si scrive
  // come 0 e nulla più grande c'è: è il massimo che Windows può mostrare. Le
  // voci da 512 e 1024 verrebbero scartate dal loader, quindi non si scrivono,
  // e il 192 si lascia fuori perché a 32 bit è quasi un BMP da 160 kB che
  // nessuna vista di Explorer chiede.
  const voci = immagini
    .filter(({ lato }) => lato <= 256 && lato !== 192)
    .map(({ lato, png, dib }) => ({
      lato,
      dati: lato >= 256 ? png : dib,
    }));
  const intestazione = Buffer.alloc(6);
  intestazione.writeUInt16LE(1, 2); // 1 = icona
  intestazione.writeUInt16LE(voci.length, 4);

  const directory = [];
  let offset = 6 + voci.length * 16;
  for (const voce of voci) {
    const riga = Buffer.alloc(16);
    riga[0] = voce.lato >= 256 ? 0 : voce.lato; // 0 vuol dire 256
    riga[1] = riga[0];
    riga.writeUInt16LE(1, 4);
    riga.writeUInt16LE(32, 6);
    riga.writeUInt32LE(voce.dati.length, 8);
    riga.writeUInt32LE(offset, 12);
    directory.push(riga);
    offset += voce.dati.length;
  }
  return Buffer.concat([intestazione, ...directory, ...voci.map((v) => v.dati)]);
}

/**
 * .icns con dentro le voci PNG. I tipi sono quelli con immagine compressa, che
 * il macOS accetta da una decina di anni: ic10 (1024) per la Retina di
 * massima qualità, giù fino a ic11 (32) per la barra.
 */
function scriviICNS(immagini) {
  const TIPI = [
    ["ic11", 32],
    ["ic12", 64],
    ["ic07", 128],
    ["ic13", 256],
    ["ic08", 256],
    ["ic14", 512],
    ["ic09", 512],
    ["ic10", 1024],
  ];
  const perDimensione = new Map(immagini.map((i) => [i.lato, i.png]));
  const voci = TIPI.filter(([, lato]) => perDimensione.has(lato)).map(([tipo, lato]) => {
    const dati = perDimensione.get(lato);
    const intestazione = Buffer.alloc(8);
    intestazione.write(tipo, 0, "latin1");
    intestazione.writeUInt32BE(dati.length + 8, 4);
    return Buffer.concat([intestazione, dati]);
  });
  const corpo = Buffer.concat(voci);
  const intestazione = Buffer.alloc(8);
  intestazione.write("icns", 0, "latin1");
  intestazione.writeUInt32BE(corpo.length + 8, 4);
  return Buffer.concat([intestazione, corpo]);
}

// -------------------------------------------------------------------- uscita

const DESTINAZIONI = [
  // electron-builder guarda qui per impostazione predefinita: build/ dentro
  // electron/. Non serve dirglielo nel package.json.
  { file: "electron/build/icon.png", lato: 1024 },
  { file: "electron/build/icon.ico", lato: 0 },
  { file: "electron/build/icon.icns", lato: 0 },
  // Le due dimensioni che Android e iOS chiedono per l'installazione a
  // schermata home, così la PWA prende la stessa icona della versione desktop.
  { file: "public/icon-192.png", lato: 192 },
  { file: "public/icon-512.png", lato: 512 },
];

const LATI = new Set([16, 24, 32, 48, 64, 128, 256, 512, 1024]);
for (const { lato } of DESTINAZIONI) {
  if (lato) LATI.add(lato);
}

const immagini = [...LATI]
  .sort((a, b) => a - b)
  .map((lato) => {
    const rgba = ridisegna(lato);
    return { lato, rgba, png: scriviPNG(rgba, lato), dib: scriviDIB(rgba, lato) };
  });

const perLato = new Map(immagini.map((i) => [i.lato, i]));

for (const { file, lato } of DESTINAZIONI) {
  const contenuto = !lato
    ? file.endsWith(".ico")
      ? scriviICO(immagini)
      : scriviICNS(immagini)
    : perLato.get(lato).png;
  const percorso = path.resolve(file);
  mkdirSync(path.dirname(percorso), { recursive: true });
  writeFileSync(percorso, contenuto);
  console.log(`${file} — ${(contenuto.length / 1024).toFixed(1)} kB`);
}
