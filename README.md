# Kizuna

**Kizuna keeps your thoughts and your people from slipping away.**

You talk to it the way you think: in Hinglish, in half sentences, in a rush. Kizuna remembers the people and moments inside what you said. At a good moment it nudges you to reach out to someone close, with a ready line and a time that works.

*Kizuna* (絆) is Japanese for the bonds between people.

Built for the Meta Global AI Developer Hackathon 2026 (Indie track). All code in this repository was written during the event.

## Why

Meta made it possible to reach anyone in the world. The close half is harder: the people one bus ride away who drift because life is loud. In-person time with friends fell from about 60 to 20 minutes a day between 2003 and 2020 (US Surgeon General, 2023). For people with ADHD traits or plain overload, "I'll call this weekend" quietly becomes five weeks.

Kizuna is built for that close half.

## What it does

| | Feature | How |
| --- | --- | --- |
| 1 | **Talk it out** | Hold the mic and talk in English, Hindi or both. Words appear as you speak. Typing always works too. |
| 2 | **Remembers for you** | Each note is turned into people, dates, plans and promises ("should call Kabir"). Dates are checked in code against the words you used. |
| 3 | **Your circle builds itself** | A long-context pass over everything you've said suggests up to 8 people who matter, and merges nicknames (Ma, Mum, Mummy). |
| 4 | **Poke, no score** | One tap drafts a short line in your own language and tone, and opens WhatsApp with it ready. You edit and send. No counters, ever. |
| 5 | **Find us a time** | Two free slots from your free hours (and, if you add it, your private calendar link). Ask in plain words: "next weekend, not Sunday". The other person gets a pick-a-time page that needs no app. |
| 6 | **Today** | Tap how much room you have (low, some, lots) and see 1, 3 or 5 things, people first. Empty is a good day. |

**Try it without talking for three weeks first:** tap **Try with sample life** on the first screen.

## Principles

- Invite, never enforce. "Not now" is a normal answer.
- No streaks, counters, "days since" numbers or red badges.
- A nudge needs a reason and a free window, outside quiet hours, under a weekly cap. Otherwise Kizuna stays quiet.
- Zero setup. Useful after one note.
- Your notes stay on your phone. You send every message yourself.
- Not a health app. Kizuna never diagnoses, tracks mood or gives advice.

## Meta models

| Model | Where | What it does |
| --- | --- | --- |
| **Muse Voice Transcribe 1.0** | `relay/src/asr.ts`, `relay/src/transcribe.ts` | Live speech to text over a WebSocket, with English + Hindi language bias and code-switching. A record-then-transcribe path takes over if streaming fails. |
| **Muse Spark 1.3**, structured output | `shared/src/tasks.ts`, `shared/src/schemas.ts` | `extract`: one note to people, events, promises, threads and gift hints ("Papa wants a brighter reading lamp", never prices) (strict JSON schema, minimal reasoning). |
| **Muse Spark 1.3**, structured output | same, guard in `relay/src/validate.ts` | `windows`: a reply in English, Hindi or Hinglish ("Sunday shaam ko free hoon", "Sat after lunch, not before 2") to at most 3 free windows. Code drops anything in the past, past 7 days, or ending before it starts. |
| **Muse Spark 1.3**, long context | same | `weave`: all notes at once to circle suggestions, merged names and threads (high reasoning). |
| **Muse Spark 1.3**, tool calling | `relay/src/plan.ts` | `plan`: turns "sometime next weekend, not Sunday" into calls to a `free_slots` tool and a `finish` tool. |
| **Muse Spark 1.3**, tool calling | `relay/src/weekend.ts`, `shared/src/weekend.ts` | `weekend`: plans one call over the Kizuna map with parallel calls to `get_windows`, `get_occasions`, `get_local_time` and `get_reasons`, then `finish`. The tools run from what the app sends, so nothing is stored. The answer is checked in code (everyone really free, outside their quiet hours in their own time zone); a plain fallback gives the same kind of answer if the model fails. |
| **Muse Spark 1.3** | `shared/src/tasks.ts` | `draft`: the poke line in your language; `rank`: orders cards when there are more than fit. |

Every model output is checked against its schema and retried once if it fails. Drafts are screened for guilt, fake urgency and length. Kizuna only uses the standard models, never the `*-contributor` models.

## How it fits together

```
Phone (PWA)                     Cloudflare Worker                 Meta Model API
IndexedDB: notes, people  --->  /api/spark   (task allowlist,  -> Muse Spark 1.3
threads, never leave the        schema check, rate limits)
phone except to be read   --->  /api/asr     (WebSocket)       -> Muse Voice Transcribe
by the model                    /api/ical    (busy times only)
                                /p/:id       pick-a-time page  <- your person, on WhatsApp
                                /api/circle  sealed map entries (ciphertext only)
                                /c/:id       family page       <- family, on WhatsApp, no app
                                KV: invites (7 days), circle entries (8 days)
```

| Route | What it does |
| --- | --- |
| `POST /api/spark` | Runs one named task: `extract`, `weave`, `draft`, `plan`, `rank`, `windows` or `weekend`. |
| `WS /api/asr`, `POST /api/transcribe` | Speech to text, live or from a recording. |
| `POST /api/ical` | Busy times from a private calendar link. |
| `POST /api/invite`, `GET /api/invite/:id`, `POST /api/invite/:id/pick`, `GET /p/:id` | Pick-a-time invites and their page. |
| `POST /api/circle` | Makes a new map circle. The key is made on the phone and only travels in the link's `#k=` part, which browsers never send. |
| `PUT` / `DELETE /api/circle/:id/m/:memberId` | Writes or removes one member's sealed entry (AES-GCM, at most 12 members, gone after 8 days). |
| `GET /api/circle/:id` | Lists the sealed entries; the phone opens them. |
| `GET /c/:id` | The family page: four big buttons (Sat or Sun, morning or evening), "Not this weekend", speak or type a reply. The answer is sealed in the browser before it is sent. English and Hindi labels. |

- `app/`: SvelteKit (Svelte 5) single-page PWA. Dexie over IndexedDB. Nudge rules, free-slot maths and the date guard run on the phone.
- `relay/`: one Cloudflare Worker that serves the app and the API from the same origin and holds the API key.
- `shared/`: the contract between them: types, task inputs and outputs, prompts, schemas, date guard, slot maths.
- `tools/fake-meta/`: a local stand-in for the Meta API, so everything runs and is tested without a key.
- `eval/`: 30 Hinglish voice-note fragments with expected answers, plus the sample life.

## Run it locally

Needs Node 22. This repo uses npm 11 (`npx npm@11`), because npm 10 trips over one peer dependency.

```bash
npx -y npm@11 install
npm run build -w @kizuna/app          # the Worker serves app/build
cp relay/.dev.vars.example relay/.dev.vars

npm run dev:fake                      # fake Meta API on :8788
npm run dev:relay                     # Worker on :8787
npm run dev                           # app on :5173, proxies /api and /p
```

To use the real API, set `META_BASE_URL=https://api.meta.ai/v1` and `MODEL_API_KEY=...` in `relay/.dev.vars`.

## Tests and eval

```bash
npm test                              # all workspaces
npm run check                         # type checks
npm run dev:fake & npm run eval       # extraction eval (or point META_BASE_URL at the real API)
```

## Deploy

```bash
cd relay
npx wrangler kv namespace create INVITES            # copy the id into wrangler.jsonc
npx wrangler kv namespace create INVITES --preview  # copy the preview_id
npx wrangler secret put MODEL_API_KEY
cd .. && npm run build -w @kizuna/app && npm run deploy -w @kizuna/relay
```

## Privacy

- No accounts. Notes, people and threads live in your browser's IndexedDB.
- Note text and audio pass through the relay to Meta's API to be understood. The relay never logs request bodies and stores nothing.
- A pick-a-time invite stores only your first name, a title and the time slots, and expires after 7 days.
- The Kizuna map shares only what you choose: your first name, time zone, up to three free windows and an optional "free today" that ends within 12 hours. Each entry is sealed on the device with a key that lives only in the family link, so the server holds ciphertext it can't read. Entries expire after 8 days, and leaving deletes yours. No location, ever.
- A calendar link, if you add one, is read through the relay for busy times only. Neither the link nor your events are stored.
- **Delete everything** in Settings clears it all.

## License

MIT
