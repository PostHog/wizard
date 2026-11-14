> AI agents: this is one page from PostHog's docs. Full index of Markdown docs for LLMs: https://posthog.com/llms.txt

# Flask

Canonical URL: https://posthog.com/docs/libraries/flask

> **Cloud region:** This page uses US Cloud hosts. For an EU Cloud project, use `https://eu.i.posthog.com` instead of `https://us.i.posthog.com` (ingestion host), and use `https://eu.posthog.com` instead of `https://app.posthog.com` (app host for links).

## On this page

- [Install with the wizard](#install-with-the-wizard)
- [Installation](#installation)
- [Identifying users](#identifying-users)
- [Request contexts](#request-contexts)
- [Error tracking](#error-tracking)
- [Next steps](#next-steps)
- [Supported versions](#supported-versions)

PostHog makes it easy to get data about traffic and usage of your Flask app. Integrating PostHog enables analytics, custom events capture, feature flags, error tracking, and more.

This guide walks you through integrating PostHog into your Flask app using the [Python SDK](https://posthog.com/docs/libraries/python.md).

> These docs cover version `7.x` of the Python SDK, which requires Python 3.10 or higher. On Python 3.9? See [supported versions](#supported-versions).

## Install with the wizard

Run this command in your project directory to add PostHog to your Flask project. The wizard detects your framework, installs the SDK, and sets up your first events.

`npx @posthog/wizard`

Or set it up manually by following the rest of this guide.

## Installation

To start, run `pip install "posthog<8"` to install PostHog’s Python SDK.

Then, initialize PostHog where you'd like to use it. For example, here's how to capture an event in a simple route:

app.py

```python
from flask import Flask
from posthog import Posthog

app = Flask(__name__)

posthog = Posthog(
    '<ph_project_token>',
    host='https://us.i.posthog.com',
)

@app.route('/api/dashboard', methods=['POST'])
def api_dashboard():
    posthog.capture(
        'dashboard_api_called',
        distinct_id='distinct_id_of_your_user',
    )
    return '', 204
```

You can find your project token and instance address in [your project settings](https://app.posthog.com/project/settings).

## Identifying users

> **Identifying users is required.** Backend events need a `distinct_id` to associate events with the correct user.
>
> In Python, you can do this through a context. All event captures in the same context will be tagged automatically with the correct `distinct_id`. Typically, you would set a fresh context and identify at the top of each route.
>
> ```python
> from posthog import new_context, identify_context, capture
>
> @app.get("/foo")
> def foo(current_user: User = Depends(get_current_user)):
>     with new_context(): # Set context at the top of a route
>         identify_context(current_user.id)
>         capture("foo_viewed")
>     return {"status": "ok"}
> ```
>
> When possible, write a small piece of **middleware** that resolves your authenticated user, wrap a context around the request, and identifies it. Every `capture()` downstream is then attributed *automatically*. The SDK's Django middleware does this automatically and you can replicate it when using the plain Python SDK.

## Request contexts

Version `7.69.0` and later of the Python SDK includes a Flask integration that creates a fresh [context](https://posthog.com/docs/libraries/python.md#contexts) for every request. It adds the request URL, method, path, route, IP address, and user agent to events captured during the request.

Register the integration after you create your Flask app and PostHog client:

app.py

```python
from posthog.integrations.flask import PosthogFlaskIntegration

PosthogFlaskIntegration(
    app,
    client=posthog,
    capture_exceptions=True,
)
```

Setting `capture_exceptions=True` captures unhandled Flask exceptions. Set it to `False` for request enrichment without automatic exception capture. If you omit it, the integration inherits the client's `enable_exception_autocapture` setting.

You can also provide:

-   `request_filter` to skip both enrichment and automatic exception capture for selected requests
-   `extra_properties` to add application-specific properties to the request context
-   `trust_tracing_headers` to accept PostHog session and distinct ID headers

If you're using [PostHog JavaScript Web](https://posthog.com/docs/libraries/js.md) on the frontend, configure [`tracing_headers`](https://posthog.com/docs/libraries/js/config.md#tracing-headers) for your Flask backend hostname so browser requests include the session and distinct ID headers.

The integration ignores these headers by default because clients can control them. Set `trust_tracing_headers=True` when registering the integration to accept them as analytics context. Don't use them for authentication or authorization.

Identify the request context from your route when you have an authenticated user ID:

```python
from flask import session
from posthog import identify_context

@app.route("/api/dashboard", methods=["POST"])
def api_dashboard():
    user_id = session.get("user_id")
    if user_id:
        identify_context(str(user_id))

    posthog.capture("dashboard_api_called")

    return "", 204
```

Events captured without a context or explicit `distinct_id` are sent as [anonymous events](https://posthog.com/docs/data/anonymous-vs-identified-events.md) with an auto-generated `distinct_id`. See the [Python SDK docs](https://posthog.com/docs/libraries/python.md#person-profiles-and-properties) for more details.

## Error tracking

`PosthogFlaskIntegration` captures unhandled exceptions when you set `capture_exceptions=True` or enable exception autocapture on its client. It doesn't capture expected HTTP exceptions or exceptions consumed by your application's error handlers.

Call `capture_exception()` from a custom error handler when you want to report a handled exception:

```python
from flask import Flask, jsonify
from posthog import Posthog

app = Flask(__name__)
posthog = Posthog('<ph_project_token>', host='https://us.i.posthog.com')

@app.errorhandler(Exception)
def handle_exception(e):
    # Capture methods, including capture_exception, return the UUID of the captured event,
    # which you can use to find specific errors users encountered
    event_id = posthog.capture_exception(e)

    # You can show the event ID to your user, and ask them to include it in bug reports
    response = jsonify({'message': str(e), 'error_id': event_id})
    response.status_code = 500
    return response
```

## Next steps

For any technical questions for how to integrate specific PostHog features into Flask (such as analytics, feature flags, A/B testing, etc.), have a look at our [Python SDK docs](https://posthog.com/docs/libraries/python.md).

Alternatively, the following tutorials can help you get started:

-   [How to set up analytics in Python and Flask](https://posthog.com/tutorials/python-analytics.md)
-   [How to set up feature flags in Python and Flask](https://posthog.com/tutorials/python-feature-flags.md)
-   [How to set up A/B tests in Python and Flask](https://posthog.com/tutorials/python-ab-testing.md)

## Supported versions

These docs cover version `7.x` of the PostHog Python SDK, which requires Python 3.10 or higher. Python 3.9 is no longer supported on `7.x.x` and higher — pin to the 6.x line with `pip install 'posthog<7'`, where `6.9.3` is the final release.

Everything on this page works the same way on `6.9.3`. Event capture, the context API (`new_context`, `identify_context`, `set_context_session`), and `PosthogContextMiddleware` are identical on `6.9.3` and `7.0.0` — `7.0.0` only dropped Python 3.9 and bumped the optional LLM provider SDKs. That includes the middleware identifying the request context from the `X-POSTHOG-DISTINCT-ID` header and falling back to the authenticated user, which behaves the same across both lines.

Later `7.x` releases add what the 6.x line does not receive, such as the Celery integration, tracing header sanitization, and `set_context_device_id`. They also changed the middleware's own captured properties: `7.x` sends the request IP as `$ip`, where `6.9.3` sends it as `$ip_address`, and `7.x` additionally captures `$request_path`, `$raw_user_agent`, and the authenticated user's `email`.
