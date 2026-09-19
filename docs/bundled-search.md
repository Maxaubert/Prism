# Bundled desktop search

Prism packages the stable Everything engine and ES query client. `fetch:everything`
verifies pinned archive hashes and includes both license notices. A normal install
does not require a separate Everything installation.

When Everything is already running, Explorer first queries that ready index using
the bundled client. Discovery and queries are read-only. Unindexed locations or
unavailable instances fall back to Prism's bundled engine. Private startup runs
in the background, with bounded and cancellable waits for search callers.

The installer offers Windows elevation for a private NTFS metadata service. Its
verified executable lives in an Administrators-owned Program Files directory.
The per-user app and its named indexing process remain unelevated. If elevation
is declined, visited folders are indexed and monitored without a service. The
initial scan, new removable locations and network shares can take time.

Each Prism profile has a private database. Additional Explorer windows share the
owner profile's index and size cache; test and preview profiles are isolated.
The final window closes its named engine. Uninstall removes only the service
whose protected ownership record matches that installation. Personal Everything
instances, services and settings are never configured by Prism.

Folder sizes use indexed totals in small batches, with filesystem traversal as a
bounded fallback. Per-folder cache records survive restart. Visible rows take
priority, stale values remain visible during refresh, and completed file changes
invalidate related records across windows. Recent changes briefly use filesystem
verification while the index catches up. Indexed sizes describe indexed coverage;
they do not invent descendant counts or imply inaccessible files were included.

Verification includes unit tests, packaged Explorer Playwright tests and an
opt-in real-engine test (`PRISM_INDEXER_INTEGRATION=1`). The `bundled-indexer` CI
job additionally installs the service on a disposable Windows runner, checks its
ACLs, queries it from a temporary nonadministrator account, and uninstalls it.
The privileged lifecycle test refuses to run on a developer desktop.

The optional Explorer test `a ready existing index` exercises an already-running
local index read-only when `PRISM_E2E_EXISTING_INDEX=1`; it verifies visible search
latency and that no private scan starts. Other tests keep private indexing bounded
to fixture roots. The default suite never depends on the developer's index.
