import { useLanguage } from "../i18n";
import { type Loaded, useLoaded } from "../lib/useLoaded";
import type { LoadedBy, ModelInfo, Recording, ShaderLibrary } from "./types";
import type { GpuSource } from "./source";

export type GpuData = {
  readonly executable: string;
  readonly libraries: readonly ShaderLibrary[];
  readonly models: readonly ModelInfo[];
  readonly recordings: readonly Recording[];
};

export type { Loaded } from "../lib/useLoaded";

async function readAll(source: GpuSource): Promise<GpuData> {
  const [executable, libraries, models, recordings] = await Promise.all([source.executable(), source.listLibraries(), source.listModels(), source.listRecordings()]);
  return { executable, libraries, models, recordings };
}

export function useGpuData(source: GpuSource, key: string): Loaded<GpuData> {
  return useLoaded(() => readAll(source), key);
}

export function useLoadedBy(source: GpuSource, library: string, name: string): Loaded<LoadedBy | null> {
  const language = useLanguage();
  return useLoaded(() => source.loadedBy(library, name), `${library}:${name}:loader:${language}`);
}

export function useFunctionIr(source: GpuSource, library: string, name: string): Loaded<string> {
  return useLoaded(() => source.functionIr(library, name), `${library}:${name}`);
}
