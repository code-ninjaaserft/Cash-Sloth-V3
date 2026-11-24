import type { Preset, PresetState, PresetSnapshot } from '@cash-sloth/contracts';
import type { CatalogStore } from './catalog-ports.js';
export interface PresetStore {
  readonly catalog: CatalogStore;
  transaction<T>(operation: () => T): T;
  list(): readonly Preset[];
  get(id: string): Preset | null;
  visibleSnapshot(): PresetSnapshot;
  setVisibleCatalog(products: readonly string[], categories: readonly string[], variants: readonly string[]): void;
  remove(id: string): void;
  put(preset: Preset): void;
  active(): PresetState['active'];
  activate(preset: Preset): void;
  catalogVersion(): string;
  assertIdle(): void;
  clearVariantMetadata(ids: readonly string[]): void;
  getOperation(id: string): { request: string; state: PresetState } | null;
  putOperation(id: string, request: string, state: PresetState): void;
}
