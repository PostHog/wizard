---
type: identify
flow: integration-v2
label: Wire user identification
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [integration-v2-identify, posthog-best-practices]
allowedTools: [Read, Edit, Glob, Grep]
disallowedTools: [enqueue_task]
dependsOn: [install, init]
---

## Goal

Wire user identification so everything the app reports — its errors as much as its
events — carries who the user is.

The distinct id is the app's own stable identifier for the user — a primary key, a
uuid, a resource name. Not an email and not a username: those are PII and they change;
send them as person properties instead. Fall back to email only when the app truly has
no other stable key, and say so in your handoff — do not invent one by altering the
app's schema.

Work out first what you are in: a client-only app, a fullstack or SSR app, or a
backend or API. Identification takes a different shape in each, and the shape
follows from that answer:

1. Client and frontend — identify once, and only once, when the user logs in or
   registers, and reset when they log out. That single call merges what was already
   captured against the anonymous id into the stable distinct id you give it. The
   library persists identity from there, so everything after it is attributed to the
   same user until reset — nothing needs re-identifying per page or per event.
2. Fullstack or SSR — your identification hinges on the client side, where the
   identity is persisted. The distinct id and the session id travel on every request
   the frontend sends, in the header format the docs describe. Some libraries already
   do this for you; read the docs and the example app before wiring it by hand. The
   backend should take note of the session and distinct id as soon as possible and
   either carry it to every capture or use the identified context to identify the
   request.
3. Backend and API — a server serves many users at once, so identity belongs to the
   request, never to the process. Take it from the incoming request or the ambient
   context, as far as the app allows. Then either tag each event with the distinct
   id and session id, or, where the SDK has contexts, open one around the whole
   request and identify that context so everything the request reports inherits it.
   Where the SDK ships a middleware for this framework, that is what does this — use
   it rather than writing your own. Read the docs and the example app.

## How you know you succeeded

Identification matches the kind of app you are in. While a user is known, what the
app reports is attributable to them with a stable distinct id — the errors it
reports, not only the events — established at the boundary the SDK gives you rather
than repeated at call sites that already inherit it. Where the app changes who the
user is mid-request, that boundary cannot know it yet, and establishing identity
again there is the point, not a duplicate. Your handoff names the files you
changed, how identity is established in them, and what a later step must do for its
own calls to inherit it — whether that is nothing at all, or tagging each call
itself. If the app has no auth or user concept, say so and stop.

You do not run builds, linters, or tests — the review task verifies the whole integration after you; your edits just need to be right by reading.
