/**
 * Everything dictation downloads, and the one thing it bundles (#13). Pure
 * data plus lookups, shared by main (which verifies against it) and the
 * renderer (which draws the model manager from it).
 *
 * THE RULE THIS FILE EXISTS FOR: nothing is run or loaded unless its bytes
 * match a SHA-256 written down here. So every url below must name bytes that
 * CANNOT change under its checksum: a GitHub release asset by tag, and a
 * Hugging Face file by COMMIT, never `resolve/main`. A url that follows a
 * branch is a download that starts failing its checksum the day upstream
 * re-uploads, on every user's machine at once, with nothing we can ship fast
 * enough to help.
 *
 * Sizes and checksums were read from the upstream APIs on 2026-09-19 (the
 * GitHub release API's `size` and `digest`; Hugging Face's `lfs.size` and
 * `lfs.oid`), and two of them were CROSS-CHECKED against files already on the
 * owner's disk with sha256sum: ggml-base.bin and ggml-large-v3.bin both matched
 * byte for byte. The commit-pinned urls were each asked for with a HEAD request
 * and answered 200 with the same size and the same hash in `X-Linked-ETag`.
 */
import type { CatalogEntry } from './dictationTypes'

/** The whisper.cpp release both the bundled CPU engine and the GPU pack come from. */
const TAG = 'b5130'
const RELEASE = `https://github.com/ggml-org/whisper.cpp/releases/download/${TAG}`

/**
 * The newest commit of huggingface.co/ggerganov/whisper.cpp on 2026-09-19
 * (the repo has not moved since 2024-10-29). Every model url is resolved
 * against it, so a later re-upload to `main` changes nothing here.
 */
const MODELS_COMMIT = '5359861c739e955e79d9a303bcbc70fb988958b1'
const model = (file: string): string =>
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODELS_COMMIT}/${file}`

/**
 * The newest commit of huggingface.co/ggml-org/parakeet-GGUF on 2026-10-04
 * (#121), the whisper.cpp project's own conversions of Parakeet TDT 0.6B v3.
 * Sizes and checksums read from the Hugging Face API the same day, and each
 * commit-pinned url HEAD-checked: 302 with the same size in `X-Linked-Size`
 * and the same hash in `X-Linked-ETag`. The q8_0 file was also downloaded and
 * matched byte for byte (sha256sum) on the owner's PC.
 */
const PARAKEET_COMMIT = '35156454d1a39de06863303dd209fd2bed6ee079'
const parakeet = (file: string): string =>
  `https://huggingface.co/ggml-org/parakeet-GGUF/resolve/${PARAKEET_COMMIT}/${file}`

/** Said where a model that does not support every language is picked or in
 *  use: the download question and the language picker's icon (owner,
 *  2026-10-04: "simple ... model agnostic ... short to the point"). */
export const LIMITED_LANGUAGES_TEXT = "This model doesn't support all languages."

/**
 * The CPU engine each app BUNDLES, fetched at build time by
 * `core/tools/fetch-whisper.mjs`. That script runs before anything is compiled,
 * so it cannot import this file and carries its own copy of the pin; the
 * catalog test reads the script as text and fails if the two ever disagree.
 *
 * `files` is the MINIMAL set whisper-server.exe needs, MEASURED rather than
 * guessed: those thirteen were copied alone into an empty folder and the server
 * started, loaded Base and transcribed a clip (answering on its port 190 ms
 * after spawn). They are the zip's `Release/` folder minus the files of other
 * programs (the whisper CLI, the benchmarks, the tests, llama.dll, SDL2).
 * Since #121 the last two are parakeet-cli.exe and parakeet.dll, the same
 * zip's Parakeet runner, which needs nothing else from it (MEASURED the same
 * way: the fifteen alone transcribe a clip with Parakeet v3).
 *
 * ALL NINE `ggml-cpu-*.dll` STAY, and that is not caution. ggml picks its CPU
 * backend at run time by what the processor supports (this machine loaded
 * `ggml-cpu-cascadelake.dll`; an older one falls to haswell, sandybridge, sse42
 * or plain x64), so which one is "needed" is a fact about the USER's PC, not
 * about ours. Dropping the ones this machine did not load would ship an engine
 * that works here and nowhere else.
 *
 * The names are FLATTENED (what the engine folder holds), not where the zip
 * kept them. The official zip carries NO licence file, so none is listed.
 */
export const ENGINE = {
  tag: TAG,
  asset: 'whisper-bin-x64.zip',
  url: `${RELEASE}/whisper-bin-x64.zip`,
  bytes: 8573270,
  sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
  files: [
    'whisper-server.exe',
    'whisper.dll',
    'ggml.dll',
    'ggml-base.dll',
    'ggml-cpu-alderlake.dll',
    'ggml-cpu-cannonlake.dll',
    'ggml-cpu-cascadelake.dll',
    'ggml-cpu-haswell.dll',
    'ggml-cpu-icelake.dll',
    'ggml-cpu-sandybridge.dll',
    'ggml-cpu-skylakex.dll',
    'ggml-cpu-sse42.dll',
    'ggml-cpu-x64.dll',
    'parakeet-cli.exe',
    'parakeet.dll'
  ]
} as const satisfies {
  tag: string
  asset: string
  url: string
  bytes: number
  sha256: string
  files: readonly string[]
}

/**
 * Multilingual models only (owner decision: auto-detect is the default, so an
 * English-only variant would be a model that silently ignores the language
 * picker). Parakeet v3 knows fewer languages than Whisper and says so
 * (`limitedLanguages`), where the picker would otherwise do nothing. In the order the model manager shows them, smallest first, with
 * the e2e's model and the GPU pack after the ones a user picks from.
 *
 * The notes say who a model is FOR and leave "Recommended" and "needs the GPU
 * pack" to the badges the manager draws from `recommended` and `needsGpu`: a
 * note repeating a badge is the same thing said twice on one row. Each note is
 * a row's subtext, so at most eight plain words (the grouped cards redesign,
 * 2026-10-05, which also dropped "CUDA 12.4": a row says what it does).
 */
export const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'base',
    label: 'Whisper Base',
    note: 'Fast live text on any PC.',
    url: model('ggml-base.bin'),
    bytes: 147951465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    kind: 'model',
    // MEASURED: about 0.9 s a pass on a CPU whatever the clip's length, which
    // is what lets the pill's text refresh once a second with no GPU at all.
    recommended: 'cpu'
  },
  {
    id: 'small',
    label: 'Whisper Small',
    note: 'More accurate, about three times slower.',
    url: model('ggml-small.bin'),
    bytes: 487601967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    kind: 'model'
  },
  {
    // PARAKEET V3 (#121; owner, 2026-10-04). NVIDIA's Parakeet TDT 0.6B v3 at
    // 8 bits, run by the pinned release's own parakeet-cli. MEASURED on the
    // owner's PC with the e2e's 11 s clip, a fresh process per pass: 0.73 to
    // 0.86 s on the CPU, 0.76 to 0.78 s on the GPU pack (16 s once, the first
    // time its kernels are compiled), the sentence exact with punctuation. So
    // it is quick with no GPU at all. It knows 25 European languages and
    // detects which by itself, so the picker has nothing to tell it.
    id: 'parakeet-v3',
    label: 'Parakeet v3',
    note: 'Fast and accurate, in fewer languages.',
    url: parakeet('ggml-parakeet-tdt-0.6b-v3-q8_0.bin'),
    bytes: 668757119,
    sha256: '4d64e9e96c2792186d072fde0034df0ad670cf680a2f53069052ead827fd600e',
    kind: 'model',
    engine: 'parakeet',
    limitedLanguages: true
  },
  {
    id: 'large-v3-turbo',
    label: 'Whisper Large v3 Turbo',
    note: 'Close to Large v3 at half the download.',
    url: model('ggml-large-v3-turbo.bin'),
    bytes: 1624555275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
    kind: 'model',
    needsGpu: true,
    recommended: 'gpu'
  },
  {
    id: 'large-v3',
    label: 'Whisper Large v3',
    note: 'The most accurate.',
    url: model('ggml-large-v3.bin'),
    bytes: 3095033483,
    sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2',
    kind: 'model',
    // MEASURED: 20 s for an 11 s clip on a fast CPU, 0.36 to 0.50 s through
    // the GPU pack. Listed without the pack, but never usable without it.
    needsGpu: true
  },
  {
    id: 'tiny',
    label: 'Whisper Tiny',
    note: 'For the automated tests only.',
    url: model('ggml-tiny.bin'),
    bytes: 77691713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
    kind: 'model',
    e2eOnly: true
  },
  {
    // The smallest official Parakeet v3 file, so the e2e runs the REAL
    // Parakeet engine on a 356 MB fetch (cached once) rather than 669 MB.
    id: 'parakeet-v3-q4',
    label: 'Parakeet v3 (4 bit)',
    note: 'For the automated tests only.',
    url: parakeet('ggml-parakeet-tdt-0.6b-v3-q4_0.bin'),
    bytes: 355615679,
    sha256: 'aa7fe2f5fb47d863ca23e8b1d490632d63a2599f515268b6d6bd656158dad45e',
    kind: 'model',
    engine: 'parakeet',
    limitedLanguages: true,
    e2eOnly: true
  },
  {
    id: 'gpu-pack',
    label: 'NVIDIA GPU acceleration',
    note: 'Large models answer in under a second.',
    // ONE pack for every NVIDIA card (measured: it runs on an RTX 5090, a card
    // newer than CUDA 12.4, after a one-time 9.1 s kernel compile), which is
    // why the 273 MB CUDA 11.8 pack of the same release is not catalogued.
    url: `${RELEASE}/whisper-cublas-12.4.0-bin-x64.zip`,
    bytes: 674539285,
    sha256: 'af520ddd034d985b55dfeea3e465ed93653ba2aee1a55e865033edc548c272a7',
    kind: 'gpu-pack'
  }
]

/** The entry of that exact id (ids are lowercase), or undefined. */
export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id)
}

/** What the model manager lists: models a user picks from, in catalog order. */
export function visibleModels(): CatalogEntry[] {
  return CATALOG.filter((e) => e.kind === 'model' && !e.e2eOnly)
}

/**
 * The model to offer when dictation is switched on with none downloaded, and
 * the one wearing the Recommended badge. `hasGpuPack` means the pack is
 * INSTALLED, not merely that an NVIDIA card is present: until it is, the GPU
 * pick would be a 1.5 GB download that then transcribes at CPU speed.
 */
export function recommendedModel(hasGpuPack: boolean): CatalogEntry {
  const want = hasGpuPack ? 'gpu' : 'cpu'
  // The test holds the catalog to exactly one of each, so the fallback is for
  // the type checker and for a catalog edited wrongly, never for a user.
  return visibleModels().find((e) => e.recommended === want) ?? visibleModels()[0]
}

/** The model picks its own language and does not support every one. */
export function limitedLanguages(modelId: string): boolean {
  return catalogEntry(modelId)?.limitedLanguages === true
}

/**
 * The language a pass is asked for: the user's choice, except for a model that
 * picks its own, which is asked for 'auto'. The STORED choice is never touched,
 * so going back to a Whisper model brings the user's language back with it.
 */
export function languageFor(modelId: string, stored: string): string {
  return limitedLanguages(modelId) ? 'auto' : stored
}

/** What runs a model: parakeet-cli for Parakeet, whisper-server otherwise. */
export function engineFor(modelId: string): 'whisper' | 'parakeet' {
  return catalogEntry(modelId)?.engine ?? 'whisper'
}

/**
 * The language picker. 'auto' is Whisper's own detection and the default; the
 * rest are ISO 639-1 codes exactly as whisper.cpp's `-l` takes them (so
 * Norwegian is `no`, Hebrew is `he`, Indonesian is `id`). Whisper knows 99
 * languages; this is the short list of the ones it does WELL, the Nordic ones
 * first after English because that is where both apps' first users are, then
 * alphabetical. A language missing here still works through Auto-detect.
 */
export const LANGUAGES: readonly { code: string; name: string }[] = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'no', name: 'Norwegian' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'ar', name: 'Arabic' },
  { code: 'zh', name: 'Chinese' },
  { code: 'cs', name: 'Czech' },
  { code: 'nl', name: 'Dutch' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'es', name: 'Spanish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' }
]
