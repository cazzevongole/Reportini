/**
 * Tipi di `identita-desktop.mjs`, per chi lo importa da TypeScript.
 *
 * Lo script è JavaScript perché gira dentro GitHub Actions senza passare da
 * una compilazione, ma i test lo importano per provare la trasformazione del
 * manifest e i controlli che il rilascio ufficiale usa — senza costruire
 * nessun pacchetto, e senza riscrivere `electron/package.json` del
 * repository. Stesso motivo di `scripts/migra-schema.d.mts`.
 */

/** Il manifest di `electron/package.json`, per i campi che contano qui. */
export interface ManifestDesktop {
  name?: string;
  productName?: string;
  version?: string;
  build?: {
    appId?: string;
    productName?: string;
    publish?: unknown;
    nsis?: { publish?: unknown };
    win?: { artifactName?: string; target?: unknown; [chiave: string]: unknown };
    [chiave: string]: unknown;
  };
  [chiave: string]: unknown;
}

/** L'identità dell'app che si scarica dal rilascio ufficiale. */
export declare const IDENTITA_UFFICIALE: {
  name: string;
  productName: string;
  appId: string;
};

/** L'identità del pacchetto di prova: stesso codice, nome e cartelle suoi. */
export declare const IDENTITA_DEV: {
  name: string;
  productName: string;
  appId: string;
  artifactName: string;
};

/**
 * La versione del pacchetto dev, a partire da quella ufficiale.
 *
 * Rieseguirla non accumula suffissi. Un suffisso che semver non accetta fa
 * fallire subito, con il motivo scritto in italiano.
 */
export declare function versioneDev(versione: string, suffisso: string): string;

/** Il manifest con l'identità dev. Non tocca quello passato. */
export declare function identitaDev(manifest: ManifestDesktop, suffisso: string): ManifestDesktop;

/**
 * Perché questo manifest non è quello ufficiale, una frase per motivo.
 *
 * Vuota quando va bene: `electron/package.json` del repository deve dare
 * un elenco vuoto, e un pacchetto appena reso dev un elenco pieno.
 */
export declare function problemiIdentita(manifest: ManifestDesktop): string[];

/** Il suffisso da usare: quello scritto, poi `GITHUB_SHA`, poi `git`. */
export declare function suffissoDaAmbiente(
  argomenti?: string[],
  ambiente?: Record<string, string | undefined>,
): string;
