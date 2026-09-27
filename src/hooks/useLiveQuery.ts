import { useMemo, useSyncExternalStore, type DependencyList } from "react";
import { getVersion, subscribe } from "../lib/sqlite/engine";

/**
 * Esegue una query SQLite sincrona e la riesegue a ogni modifica del database.
 * Ogni scrittura chiama `notifyChange()`, quindi le viste restano allineate
 * senza bisogno di una libreria di stato esterna.
 */
export function useLiveQuery<T>(query: () => T, deps: DependencyList = []): T {
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(query, [...deps, version]);
}
