export function getAstroDocumentation({
  projectApiKey = 'your_project_api_key',
  host = 'https://us.i.posthog.com',
}: {
  projectApiKey?: string;
  host?: string;
}) {
  return `
==============================
FILE: src/components/posthog.astro
LOCATION: Components folder (create if missing)
==============================
Changes:
- Add a PostHog loader script with \`is:inline\`.

Example:
--------------------------------------------------
---
// src/components/posthog.astro
---
<script is:inline type="text/javascript" id="posthog-js">
  !(function(t, e) {
    var o, n, p, r;
    e.__SV ||
      ((window.posthog = e),
      (e._i = []),
      (e.init = function(i, s, a) {
        function g(t, e) {
          var o = e.split('.');
          2 == o.length && ((t = t[o[0]]), (e = o[1])),
            (t[e] = function() {
              t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
            });
        }
        ((p = t.createElement('script')).type = 'text/javascript'),
          (p.crossOrigin = 'anonymous'),
          (p.async = true),
          (p.src = s.api_host + '/static/array.js'),
          (r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(p, r);
        var u = e;
        void 0 !== a ? (u = e[a] = []) : (a = 'posthog');
        u.people = u.people || [];
        u.toString = function(t) {
          var e = 'posthog';
          return 'posthog' !== a && (e += '.' + a), t || (e += ' (stub)'), e;
        };
        u.people.toString = function() {
          return u.toString(1) + '.people (stub)';
        };
        o =
          'capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId'.split(
            ' '
          );
        for (n = 0; n < o.length; n++) g(u, o[n]);
        e._i.push([i, s, a]);
      }),
      (e.__SV = 1));
  })(document, window.posthog || []);
  posthog.init('${projectApiKey}', { api_host: '${host}', defaults: '2025-05-24' });
</script>
--------------------------------------------------

==============================
FILE: src/layouts/PostHogLayout.astro
LOCATION: Layouts folder (create if missing)
==============================
Changes:
- Insert the new \`<PostHog />\` component in the \`<head>\`.

Example:
--------------------------------------------------
---
import PostHog from '../components/posthog.astro';
---
<html>
  <head>
    <PostHog />
  </head>
  <body>
    <slot />
  </body>
</html>
--------------------------------------------------

==============================
FILE: any page you want analytics on, e.g. src/pages/index.astro
LOCATION: Your page file
==============================
Changes:
- Wrap content with the new layout.

Example:
--------------------------------------------------
---
import PostHogLayout from '../layouts/PostHogLayout.astro';
---
<PostHogLayout>
  <!-- existing page content -->
  <h1>Welcome to Astro</h1>
</PostHogLayout>
--------------------------------------------------
`;
}
