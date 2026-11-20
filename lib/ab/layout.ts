// Where an experiment lives inside a release (review items 3, 7; the shared layout ruling of 2026-11-19).
//
// `openlen/` is already a reserved root (`RESERVED_ROOTS` in lib/agent/ficheros/folder.ts: no project file can be saved
// there), so the manifest and Variant B's tree can never collide with, or hide, a file of the owner's — and nothing had
// to be reserved just for A/B. Zero imports: the publisher, the sidecar and the tests share these strings.

/** The platform's reserved root inside a release. */
export const AB_RELEASE_DIR = "openlen";
/** The manifest, relative to the release: `<release>/openlen/ab.json`. */
export const AB_MANIFEST_PATH = `${AB_RELEASE_DIR}/ab.json`;
/** Where one experiment's Variant B tree lives, relative to the release: `openlen/ab/<id>/b`. */
export const abVariantPrefix = (experimentId: string): string => `${AB_RELEASE_DIR}/ab/${experimentId}/b`;
