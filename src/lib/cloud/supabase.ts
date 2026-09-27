import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { problemaDiChiave, tipoDiChiave, type TipoChiave } from "./chiave";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const chiave = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

/**
 * Una chiave segreta finirebbe nel bundle e darebbe a chiunque l'accesso ai
 * dati di tutti: in quel caso non avviamo il client e spieghiamo il motivo.
 */
export const problemaConfigurazione: string | null = problemaDiChiave(chiave);

export const supabase: SupabaseClient | null =
  url && chiave && !problemaConfigurazione
    ? createClient(url, chiave, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

export const cloudEnabled = supabase !== null;

export const tipoChiave: TipoChiave = tipoDiChiave(chiave);
