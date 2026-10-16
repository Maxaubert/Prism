# The address phones use (#406)

Optional. Without it a phone pairs with `http://<this PC's address>:<port>`, as it always has.
With it, the pairing QR and link carry an address of your choosing: a friendly name on your
own network, or HTTPS through your own reverse proxy. Prism never ships a certificate and never
needs any of this.

Set it in **More > Phone > Address phones use**. Only an origin is kept: `http://` or
`https://`, a host and an optional port. No path, query or login. Empty goes back to this PC's
address.

## Why HTTPS matters here

Prism's phone server is plain HTTP, so the phone's access token travels unencrypted on your
Wi-Fi (security review, `research/prism/2026-10-14-phone-access-review.md`). A reverse proxy
with a real certificate encrypts it, and the phone shows no warning. A certificate from Let's
Encrypt needs a domain you own. A name that only your own network knows (`prism.home`) can be
friendly, but it cannot get a certificate a phone trusts.

## One way to set it up (Nginx Proxy Manager and AdGuard Home)

The owner's setup, `Documents\homelab\compose.yaml`; any reverse proxy and local DNS work the
same way.

1. **Name to PC.** In AdGuard Home (admin `http://127.0.0.1:8080`), Filters > DNS rewrites, add
   `prism.example.com` -> this PC's LAN address. The phone must use AdGuard for DNS (router DHCP
   or the phone's own DNS setting).
2. **Proxy to Prism.** In Nginx Proxy Manager (admin `http://127.0.0.1:81`), add a proxy host for
   `prism.example.com`, forwarding to `http://<this PC's LAN address>:<Prism's phone port>` (the
   port is shown in More > Phone). Turn on "Websockets support" and "Block common exploits".
3. **Certificate.** On the SSL tab, request a Let's Encrypt certificate with a **DNS challenge**
   (Cloudflare and others): it works without opening any port to the internet. Turn on "Force
   SSL".
4. **Prism.** More > Phone > Address phones use: `https://prism.example.com`, Save. Pair again.

## The walls, through a proxy

- Every request reaches Prism from the proxy, which is on your own network, so Prism's
  "own network only" rule passes it. Every client address the proxy reports (`X-Real-IP`, each
  `X-Forwarded-For` hop, `Forwarded: for=`) must ALSO be on your own network, or the request is
  refused (`forwardedLocal` in `src/main/phone/lan.ts`). A proxy that is reachable from the
  internet therefore still cannot carry the internet in.
- **Do not forward ports 80 or 443 to this PC on your router.** The DNS challenge in step 3 is
  what makes that unnecessary.
- Pairing, the code's two minutes, read-only access and the per-phone walls are unchanged.
