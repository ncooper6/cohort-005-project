# Research: notification services and vendors for Cadence

Ticket: [#4](https://github.com/ncooper6/cohort-005-project/issues/4) · Map: [#3](https://github.com/ncooper6/cohort-005-project/issues/3) · Researched 2026-11-11 against official docs and pricing pages (URLs inline).

**Question.** Which kind of third-party service, and which vendor, should deliver Cadence's real-time in-app Notifications (bell/inbox + live toasts, no email/push/SMS)?

- **(a) Notification-inbox products:** Knock, Novu, MagicBell, Courier. The vendor stores Notifications and read state and ships a React inbox.
- **(b) Realtime pub/sub:** Pusher Channels, Ably. Cadence stores Notifications and read state in SQLite, and the vendor only pushes them live.

Every fact below comes from the cited page as read on 2026-11-11. Lines marked **(inference)** are my analysis, not vendor claims.

---

## At a glance

| | Knock | Novu | MagicBell | Courier | Pusher Channels | Ably |
|---|---|---|---|---|---|---|
| Category | (a) | (a) | (a) | (a) | (b) | (b) |
| Free tier | 10k messages/mo | 10k workflow runs/mo, 5 workflows, 24h activity retention | 1,000 deliveries/mo, 1 project | 10k sends/mo | 200k messages/day, 100 concurrent connections | 6M messages/mo, 500 connections, 500 channels (500 MAU on pricing page) |
| First paid tier | Starter $250/mo | Pro $30/mo | Startup $249/mo | Pay-as-you-go $0.005/send | Startup $49/mo | Pro from $29/mo |
| Node SDK | `@knocklabs/node` | Node SDK (package name not verified, see below) | Not documented as a separate server SDK | `@trycourier/courier` (not verified) | `pusher` | `@ably/pubsub-server` |
| React SDK | `@knocklabs/react` | `@novu/react` | `@magicbell/react` | `@trycourier/courier-react` | None official (`pusher-js`) | `@ably/pubsub-device/react` hooks |
| Prebuilt inbox UI | Yes | Yes | Yes | Yes | No | No |
| Client auth | RS256 user JWT (enhanced security mode) | HMAC-SHA256 `subscriberHash` | HS256 user JWT | Scoped JWT from `/auth/issue-token` | Server-signed private-channel auth | JWT or TokenRequest signed with API key |
| Runs offline | No | Yes, self-hosted community edition (MIT core) | No | No | No | No |
| Lock-in | High | Medium | High | High | Low | Low |

---

## (a) Notification-inbox products

### Knock

- **Free tier.** "Free" plan: up to 10,000 messages sent per month, unlimited stored profiles, and in-app feeds with the Feed API and prebuilt components included. Next tier is Starter at $250/month plus usage, with 50,000 messages included. [knock.app/pricing](https://knock.app/pricing)
- **Node SDK.** `@knocklabs/node`, initialised with an API key from an env var. There is also a separate Management API SDK and a CLI that pulls workflows into the repo. [docs.knock.app/developer-tools/sdks](https://docs.knock.app/developer-tools/sdks), [Knock CLI](https://docs.knock.app/developer-tools/knock-cli)
- **React SDK and inbox.** `@knocklabs/react` provides `NotificationFeedPopover`, `NotificationFeed` and `NotificationIconButton` (bell with unread/unseen badge), plus headless hooks for custom UI. [React overview](https://docs.knock.app/in-app-ui/react/overview)
- **Restyling.** Theming uses CSS variables (`--rnf-` prefix) and `rnf-` class names. You can drop the default CSS import and write your own, replace each cell with the `renderItem` prop and the header with `renderHeader`, and set `colorMode` for dark mode. Tailwind is not mentioned. [Customizing feed components](https://docs.knock.app/in-app-ui/react/customizing-feed-components)
- **Identity and auth.** Users are identified by your own user id. Clients use a public key. With **enhanced security mode** off (the default), the public key alone can act as any user. With it on, requests need a **signed user token**: an RS256 JWT with `sub` = user id, signed with a private signing key using `signUserToken(userId, { expiresInSeconds })` from `@knocklabs/node`. Signing happens locally, the default expiry is 3600s, and `onUserTokenExpiring` signals when to refresh. [Security & authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
- **Local/offline and tests.** I found no local emulator or testing guide in Knock's docs. Separate environments and the CLI exist, but every feed read goes to Knock's cloud. **(inference)** vitest would mock `@knocklabs/node`. Offline dev would show an empty or broken inbox unless the UI is built on the headless hooks and the provider is swapped out.
- **Lock-in.** High **(inference)**: Knock holds the Notifications, read/seen state and workflows (templates live in Knock, or in the repo through the CLI), and the client UI talks to Knock directly.

### Novu

- **Free tier.** 10,000 workflow runs/month, unlimited subscribers, In-App channel included, 5 workflows, 2 environments, 3 team members and 24h activity-feed retention. Pro costs $30/month for 30k+ runs, then $1.20 per 1k. [novu.co/pricing](https://novu.co/pricing)
- **Node SDK.** Not covered by the pages I read. The production guide only shows hash generation with Node's `crypto`. Verify the package name in the Node SDK docs before building.
- **React SDK and inbox.** `@novu/react` (React 18+, React 19 supported). `<Inbox />` is composed of `Bell`, `Notifications`, `InboxContent` and `Preferences`. A headless option uses hooks from `@novu/react`, or `@novu/js` for framework-agnostic code. [Inbox overview](https://docs.novu.co/platform/inbox/overview)
- **Restyling.** The `appearance` prop takes `baseTheme` (built-in `dark`), `variables` (`colorPrimary`, `borderRadius` and so on), `elements` (per-element style objects **or class strings, with Tailwind classes shown in the docs**), `icons` and `animations`. Element callbacks can return classes based on unread count or payload. Styles are injected into `<head>` or a shadow root. Of the inbox products, this has the closest fit to Tailwind/shadcn tokens. [Styling](https://docs.novu.co/platform/inbox/configuration/styling)
- **Identity and auth.** `<Inbox applicationIdentifier subscriberId />`, and subscribers are created on first session. In production, enable **HMAC encryption** on the Novu In-App integration. The server computes `subscriberHash = HMAC-SHA256(secretKey, subscriberId)` as lowercase hex, and once HMAC is enabled, "the Inbox will not load" without the hash. [Prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production)
- **Local/offline and tests.** A **community self-hosted edition** exists with a Docker deployment guide. Some cloud-only features are unavailable there, and social login is not supported. [Self-hosting overview](https://docs.novu.co/community/self-hosting-novu/overview). The core repo is MIT-licensed, and the `enterprise` folder is under a commercial license. [github.com/novuhq/novu](https://github.com/novuhq/novu). **(inference)** A local Novu stack is heavy (several services) compared with Cadence's single SQLite file. vitest would still mock the SDK.
- **Lock-in.** Medium **(inference)**: data and workflows live in Novu, but the MIT core gives a self-host exit.

### MagicBell

- **Free tier.** "Builder", $0: 1,000 deliveries/month, 1 project. Startup costs $249/month for 50k deliveries. [magicbell.com/pricing](https://www.magicbell.com/pricing)
- **Node SDK.** The docs list a "Browser/Node Client" ([magicbell-js](https://www.magicbell.com/docs/libraries/magicbell-js)). No dedicated server SDK is described on the pages I read.
- **React SDK and inbox.** `@magicbell/react` provides `Inbox`, `FloatingInbox` (bell + panel), `ToastContainer`, `UserPreferences` and others. Hooks are not documented on that page. [React library](https://www.magicbell.com/docs/libraries/magicbell-react)
- **Restyling.** Import component CSS, target predefined class names, and override CSS variables (e.g. `--magicbell-bg-default`) for theming and dark mode. Tailwind is not mentioned.
- **Identity and auth.** A **user JWT** generated on your server, **HS256** with the project Secret Key, with claims `user_external_id` and/or `user_email` plus `api_key`. The docs' example uses plain `jsonwebtoken`. [User JWT](https://www.magicbell.com/docs/api/authentication/user)
- **Local/offline and tests.** None documented. Mock in tests.
- **Lock-in.** High **(inference)**. The free tier is also the smallest (1,000 deliveries/month).

### Courier

- **Free tier.** "Developer": 10,000 sends/month. The pricing page does not say whether Inbox is included. Business is pay-as-you-go at $0.005/send. [courier.com/pricing](https://www.courier.com/pricing)
- **Node SDK.** The docs show `client.auth.issueToken({ scope, expires_in })`. The package `@trycourier/courier` is named, but I did not confirm it on the main docs. [Inbox authentication](https://www.courier.com/docs/platform/inbox/authentication)
- **React SDK and inbox.** `@trycourier/courier-react` (v9, React 18+) provides `<CourierInbox />` and `useCourier()`. You can supply your own views while the SDK manages messages. Toasts sync to the same feed, and messages arrive "in real time." [Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview)
- **Restyling.** A `CourierInboxTheme` object. Tailwind is not mentioned.
- **Identity and auth.** The backend calls `POST /auth/issue-token` with a scope such as `user_id:<id> inbox:read:messages inbox:write:events`, and the client calls `signIn({ userId, jwt })`. If `expires_in` is omitted, the token never expires, and "the SDKs do not refresh tokens."
- **Local/offline and tests.** None documented. Mock in tests.
- **Lock-in.** High **(inference)**. Courier is a broad multi-channel orchestration product, and most of it is out of scope for an in-app-only Cadence.

---

## (b) Realtime pub/sub with SQLite storage

Under (b), Cadence owns a `notifications` table (recipient, type, payload, `readAt`, `createdAt`) in Drizzle/SQLite. The bell/inbox is a normal loader plus shadcn components, and "mark as read" is a normal action. After inserting a row, the server publishes a small event on a per-user channel, and the client shows a `sonner` toast and revalidates. **(inference)** That design is the reason the vendor surface is so small.

### Pusher Channels

- **Free tier.** Sandbox: 200k messages/day, 100 concurrent connections, standard support. Startup costs $49/month for 1M/day and 500 connections. [pusher.com/channels/pricing](https://pusher.com/channels/pricing)
- **Node SDK.** `pusher` (`npm install pusher`): `new Pusher({ appId, key, secret, cluster })`, then `pusher.trigger(channel, event, data)`. [Getting started](https://pusher.com/docs/channels/getting_started/javascript/)
- **React SDK and UI.** No official React SDK or hooks are mentioned. The client is `pusher-js`, so a ~20-line `useEffect` hook is needed **(inference)**. There is no prebuilt UI, and all UI would be shadcn, giving full styling control.
- **Identity and auth.** **Private channels** (e.g. `private-user-<id>`) require "an authorization token signed by your server". The client POSTs `socket_id` and `channel_name` to your endpoint (default `/pusher/auth`), and the server returns `pusher.authorizeChannel(socketId, channel)`, or 403. This fits a React Router resource route that checks the DevUI session user. [Authorizing users](https://pusher.com/docs/channels/server_api/authorizing-users/)
- **Local/offline and tests.** No official emulator. **(inference)** Offline dev still works because the inbox is in SQLite and only the live push is missing. vitest fakes a one-method `publish` interface. Third-party Pusher-protocol-compatible servers exist, but I did not verify them against primary sources.
- **Lock-in.** Low **(inference)**: the vendor holds no data, so swapping vendors means replacing one publish call, one auth route and one client hook.

### Ably

- **Free tier.** Limits page: 6,000,000 messages/month, 500 concurrent connections, 500 concurrent channels, 500 msg/s, 64 KiB per message, 24h default history (max 30 days). [Limits](https://ably.com/docs/platform/pricing/limits). The pricing page frames Free as "up to 500 MAUs", and Pro costs from $29/month for 1k MAUs. [ably.com/pricing](https://ably.com/pricing)
- **Node SDK.** `@ably/pubsub-server`: `createRealtimeClient({ key, clientId })`, then `channel.publish(name, data)`. [Node getting started](https://ably.com/docs/getting-started/node). *Note:* this differs from the long-standing `ably` npm package, so check the current package before installing.
- **React SDK and UI.** Hooks are exported from `@ably/pubsub-device/react`: `PubSubClientProvider`, `ChannelProvider`, `useChannel`, `useConnectionStateListener` and `usePresence`. There is no prebuilt UI, and Ably's own guide builds its UI with Tailwind. [React getting started](https://ably.com/docs/getting-started/react)
- **Identity and auth.** Token auth: the browser gets an `authUrl`/`authCallback`, and the SDK fetches and **auto-renews** tokens. The recommended format is a **JWT signed with your API key** ("any JWT library works"; no Ably SDK needed on the server), carrying `clientId` and per-channel **capabilities**. That lets a token for Student X subscribe only to `notifications:user-X`. Token TTL is at most 24h. [Token auth](https://ably.com/docs/auth/token)
- **Local/offline and tests.** No official emulator. Same position as Pusher: SQLite holds the truth and vitest fakes the publish seam.
- **Lock-in.** Low **(inference)**, same reasoning as Pusher.

---

## Cross-cutting analysis (inference)

- **Restyling to shadcn/Tailwind.** Under (b) the UI is ours by construction. Under (a), Novu (Tailwind classes through `appearance.elements`) and Knock (CSS vars + render props, or headless hooks) come closest. In every (a) product, a fully shadcn look means using headless hooks, which gives up most of the "free inbox" benefit.
- **DevUI user switching.** Every vendor needs a server-side endpoint that mints a per-user credential from the session user (Knock RS256, Novu HMAC, MagicBell HS256, Courier issue-token, Pusher channel auth, Ably JWT). When the DevUI switches users, the client must re-authenticate: Knock re-runs `authenticate`, Ably calls `authorize()` or reconnects, and Pusher re-subscribes.
- **Seeded placeholder data.** Issue #3 wants prototypes on seeded data. Under (b), Notifications seed through the existing `db:seed`. Under (a), seeding means triggering workflows against the vendor's cloud for each seeded user, and the data is not reset by reseeding.
- **Domain model.** Under (b), **Notification** (GLOSSARY.md) is a first-class Cadence table that can join to Enrollments and Refund Requests and be backfilled. Under (a), it lives in the vendor and is reached only through their API.
- **Cost of (b).** We build the bell, list, unread count and mark-read ourselves. With shadcn (`Popover`, `ScrollArea`, `Badge`) and `sonner` already installed, that is small.
- **Free-tier fit.** For a cohort project, every free tier is adequate except possibly MagicBell (1k deliveries) and Pusher's 100 concurrent connections, which is plenty for dev.

---

## Recommendation (for the human to decide in the grilling ticket)

> **Recommended: category (b), realtime pub/sub with Notifications stored in SQLite, using Ably.** Pusher Channels is a close second.

Why (b):
- Full shadcn/Tailwind control.
- Notifications seed and reset with `db:seed`.
- The domain entity stays in Drizzle.
- Offline dev and vitest work because the vendor is a single publish seam.
- Lock-in is lowest.

Why Ably over Pusher:
- Larger free tier (6M messages/month and 500 connections, against Pusher's 100 connections).
- Official React hooks.
- Auth tokens that are auto-renewed and capability-scoped per channel, signable with any JWT library.

Pusher is simpler to wire (`authorizeChannel` in one resource route) and equally low lock-in. If Ably's package rename (`@ably/pubsub-server` / `@ably/pubsub-device` instead of `ably`) causes friction, Pusher is the fallback.

If the human would rather not build the inbox UI, the best (a) option is **Novu**: Tailwind-class styling, a $0/10k free tier, a cheap first paid tier, and an MIT self-host exit. Knock is the more polished alternative but has a $250/month next tier.
