| sub | item | reason | date |
|---|---|---|---|
| sec | phone server: plain HTTP cookie (#29) | The owner chose plain HTTP with an expiring, rotating HttpOnly cookie ("Expire + cookie", 2026-11-19). TLS was ruled out because of the self-signed warning on the phone. The server is opt-in and LAN-only. | 2026-11-21 |
| bloat | xlsx from the SheetJS CDN (#58) | The lockfile pins the tarball by sha512, so a changed file fails the install. A mirror would add about 7 MB to the repo right after the history cleanup (#535). Check SheetJS advisories by hand at each bump. | 2026-11-21 |
