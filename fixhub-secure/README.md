# ServePoint — Secure deployment (split frontend + backend)

The ServePoint Ghana app, organized so the Groq key can never be seen or
taken from the browser — the same split as NetBuddy secure.

How the split protects the key:

  browser --POST /api/chat--> server.js --key attached HERE--> Groq
    only chat text in,            .env lives on YOUR machine
    reply+service out             only public/ is ever served
    NO key in either direction

- server.js + src/*.js hold the key (from .env into process memory).
  The server ONLY serves files inside public/ — server.js, src/ and
  .env return 404 and can never be downloaded.
- public/index.html contains ZERO secrets. Its only AI call is
  fetch("/api/chat") on the same server (plus the documented public
  APIs: your Supabase project, Paystack popup, Google Fonts,
  BigDataCloud reverse-geocode).
- The assistant's instructions live in src/persona.js on the server —
  visitors cannot read or override them. The server also allowlists the
  trade (plumbing..hvac) before answering.
- Hardening: per-IP rate limiting (30 AI chats/min), body-size caps
  (64 KB), strict message validation (12 turns max, 2000 chars each),
  hardened response headers (see below), generic browser errors with
  details in your terminal only.
- Proof: npm test runs security smoke tests that fail the build if
  any secret reference ever appears in public/ — plus header, CSP,
  no-inline-style, and redirect assertions.

Project layout:

  fixhub-secure/
    server.js            # thin entry point: routing + listen
    src/
      config.js          # .env loading + validation (key lives here)
      persona.js         # assistant instructions (server-side)
      ai.js              # Groq client (key attached here only)
      chat.js            # POST /api/chat: validate -> Groq -> answer
      rateLimit.js       # per-IP sliding-window limiter
      static.js          # traversal-safe static serving + headers
      admin.js           # private admin authorization, artisan moderation, analytics
      admin-management.js # account, service, and booking administration
    public/              # EVERYTHING the browser may download
      index.html         # markup + views (loads the files below)
      styles.css         # all hand-written CSS (no frameworks)
      app.js             # PART 4: config, data, backend, router, home
      flows.js           # PART 5: booking, tracking, pay, history, AI chat
      config.js          # PUBLIC keys only (Supabase anon + Paystack public)
    test/
      security.test.js   # npm test — proves the split holds
    .env.example         # server-only Groq, Supabase admin, and Paystack keys
    package.json / README.md

Setup (3 minutes):

  cd fixhub-secure
  cp .env.example .env        # Windows: copy .env.example .env
  # edit .env and set the server-only keys described below
  # edit public/config.js: paste Supabase URL + anon key + Paystack PUBLIC key
  node server.js
  # open http://localhost:8000

Needs Node.js 18+ (node -v). Zero dependencies — npm install is not
required. Run npm test any time to re-verify the split. GET /api/health
shows whether Server AI is configured (never the key).

Without a Groq key the app still runs: /api/chat answers 503 and the
chat falls back to built-in keyword triage on the phone.

Currency and artisan accounts:

- Prices and totals are entered and shown in Ghanaian cedis (GH₵). Paystack
  receives the amount in pesewas (cedis × 100) with currency `GHS`.
- Artisan registration collects a full name, contact phone, trade, and area
  before Google sign-in. Name, trade, and area are saved to `profiles`;
  contact numbers are stored separately in `artisan_private_details`, which
  has row-level security so artisans can access only their own phone number.
  Run `src/supabase.sql` first, then `src/artisan-private-details.sql`,
  `src/admin-portal.sql`, `src/live-tracking.sql`, and `src/admin-management.sql`.
  The base schema
  contains `profiles`, `bookings`, and `applications`; the follow-up adds
  `artisan_private_details`, `notifications`, `booking_payment_state`, and
  `artisan_payout_accounts`,
  plus the security policies, indexes, and triggers. The admin migration adds
  suspension enforcement and an audit log. The live-tracking migration makes
  accepted-artisan assignment atomic, protects booking status changes, and
  enables private, latest-point-only GPS sharing. The admin-management
  migration adds the service catalog, account blocking, and retained audit
  events. Apply all five scripts in
  order when upgrading an existing deployment. All scripts can be re-run safely.
- Artisans see only open requests matching their saved trade. Customers and
  artisans receive persistent in-app notifications for applications, job
  updates, payment confirmation, and payouts.
- During an active accepted job, an artisan can explicitly start or stop GPS
  sharing. Only that booking's customer can retrieve the latest point; points
  are removed when sharing stops or the job ends. Customers see the point on
  an OpenStreetMap tile map rather than as coordinates; viewing the map sends
  the location to OpenStreetMap's tile servers. Browser geolocation requires
  HTTPS outside localhost.
- Visible signed-in sessions refresh matching jobs and notifications every
  five seconds. New updates appear in an in-app popup without reloading.
- The private admin portal is at `/admin` and is not linked in public navigation.
  Set `ADMIN_EMAIL` to the owner's Google account in the server `.env` or host
  environment. The server verifies that exact Google identity on every admin
  request; no admin password or service-role key is sent to the browser.
- Suspending an artisan removes them from discovery and prevents new applications.
  Pending applications are declined; existing accepted jobs are not canceled.
  Suspension and reinstatement reasons are recorded in `admin_action_log`.
- The admin menu includes analytics, accounts, services, bookings, and an audit log.
  Blocking an account bans sign-in and restricts existing sessions at the database
  and API layers. Admin accounts cannot be blocked or deleted. Removing a service
  hides it from new bookings while preserving old bookings. Account and booking
  deletion is permanent; booking summaries and action reasons remain in the audit
  log. An artisan with an active accepted job must resolve it before deletion.
- Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, and `PAYSTACK_SECRET_KEY` in the
  server `.env` or host environment. Never put the service-role or Paystack
  secret keys in `public/config.js`.
- Set the Paystack webhook URL to `https://YOUR_DOMAIN/api/paystack/webhook`
  and enable `charge.success`, `transfer.success`, `transfer.failed`, and
  `transfer.reversed`. The webhook verifies the signature and transaction
  server-side. After the customer confirms completion, 90% of the booking
  total is transferred to the artisan; Paystack fees/platform share are not
  calculated here.
- Artisans must save a Ghana bank payout account in Account before a customer
  can confirm completion. Paystack receives the bank details; ServePoint
  stores only the generated recipient code. Keep sufficient GHS balance in
  the Paystack transfer balance for payouts.
- The in-app assistant explains verified navigation, privacy, and payment
  behavior. Refund processing/status is not configured; the assistant cannot
  confirm an individual refund and directs users to support at 0800 349 548.

Deploying (VPS, Render, Railway…):

1. Upload everything EXCEPT .env (it is git-ignored).
2. Set GROQ_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
   SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, and PAYSTACK_SECRET_KEY in the host dashboard.
   Fill public/config.js with only the public Supabase anon and Paystack keys.
3. Run node server.js (or npm start). Put HTTPS in front (host TLS):
   enable the host's "force HTTPS" option. Only if the host cannot do
   the redirect itself, set FORCE_HTTPS=1 so this server 301-redirects
   http to https (requires the proxy to send X-Forwarded-Proto).
4. HSTS rollout: the server sends `Strict-Transport-Security: max-age=300`
   by default. Once HTTPS is stable, raise it in stages via the env:
   HSTS_MAX_AGE=86400, then HSTS_MAX_AGE=31536000, and only at the end
   HSTS_INCLUDE_SUBDOMAINS=1. Short periods first so a bad TLS setup
   self-heals instead of bricking the site for a year.
5. Supabase redirect URLs (REQUIRED for Google login): in your Supabase
   dashboard go to Authentication -> URL Configuration and add your live
   URL to Redirect URLs, e.g. https://YOUR-APP.onrender.com/** (keep the
   localhost entry for local testing). The app builds its login redirect
   from the current origin, so no code change is needed — but until the
   live URL is allowlisted, Google login bounces back to localhost.
6. Render: create a Node Web Service (start command: node server.js, or
   npm start). Put GROQ_API_KEY in the host environment dashboard —
   never upload .env. A plain Static Site serving public/ also runs the
   app, but only the Web Service gives you server AI + security headers
   (on a static host the assistant falls back to on-device triage).
   After every redeploy: Render dashboard -> Manual Deploy -> Clear
   build cache & deploy, then hard-refresh your browser (Ctrl+Shift+R).
   If pages ever look "stacked", open devtools console and compare
   window.APP_REV with the latest rev — a stale cached bundle is the
   cause; the router hides every view except the active one, so two
   visible pages always means mismatched files.

Response headers (every static + API response carries them):

  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN (+ CSP frame-ancestors 'self')
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=300 (configurable, see above)
  Cross-Origin-Opener-Policy: same-origin-allow-popups — NOT same-origin,
    because the Google-login and Paystack popups need window.opener.
  Cross-Origin-Resource-Policy: same-origin
  Content-Security-Policy (no 'unsafe-inline' in script-src/style-src,
  no data: in style-src/font-src, no wildcards):
    default-src 'self';
    script-src 'self' https://js.paystack.co;
    style-src 'self' https://fonts.googleapis.com https://paystack.com;
    style-src-attr 'unsafe-inline'; (Paystack's checkout UI requires inline
      style attributes; shipped app markup still has none)
    font-src 'self' https://fonts.gstatic.com;
    img-src 'self' data: blob: https://tile.openstreetmap.org;
                                        (data: = canvas photo previews,
    media-src 'self' blob:;             blob: = photo/voice object URLs —
                                        functionally required, kept here only)
    connect-src 'self' https://*.supabase.co https://api.bigdatacloud.net
      https://get.geojs.io https://js.paystack.co https://api.paystack.co;
    frame-src 'self' https://js.paystack.co https://checkout.paystack.com;
    object-src 'none'; base-uri 'self'; form-action 'self';
    frame-ancestors 'self'; upgrade-insecure-requests
  CORS: no Access-Control-Allow-Origin is ever sent — the API is
  same-origin only (the browser blocks cross-origin reads by default).

  SRI note: the only external script is the Paystack CDN loader. It ships
  WITHOUT an integrity hash on purpose: js.paystack.co sends no
  Access-Control-Allow-Origin header, so integrity+crossorigin would BLOCK
  the payment script from loading (verified in-browser: CORS-mode fetch
  fails while no-cors succeeds). It is pinned via CSP script-src instead;
  current sha384 for manual checks:
    sha384-QrP0u+4fz1ULjkyrXuG/dik/AMsB81GAIHKFg628v7P2r5s2kN2CiCeXlwd2uK+i
  (re-download https://js.paystack.co/v1/inline.js and compare before
  trusting it). Same-origin scripts need no SRI (served by this server).
  style-src note: app markup/JS contain zero style="..." attributes (npm
  test enforces this) — dynamic colors go through the allowlisted tintCls()
  helper. Paystack's checkout injects inline style attributes, so the
  narrowly scoped style-src-attr exception is required for its iframe.
  COEP is omitted because it blocks Paystack's cross-origin checkout iframe;
  the app does not require cross-origin isolation.

The Perchance preview variant (index.html + main.pjs at the project root)
cannot send HTTP headers — the platform serves it. All of the above
applies to THIS package only.

Rotating a leaked key: revoke it at console.groq.com, put the new one in
.env (or the host dashboard), restart. Nothing in the frontend changes.

Relation to the Perchance preview: the Perchance generator (index.html +
main.pjs at the project root) calls Groq directly from the browser with a
key pasted in main.pjs — the only way a pure client-side preview can reach
Groq, and anyone can copy that key. Treat the preview key as disposable
(dedicated key, tight limits) and run THIS secure package for real use.
