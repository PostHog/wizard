export function getAstroDocumentation(_: {
  language: 'typescript' | 'javascript';
}): string {
  return `
# PostHog Astro Integration

PostHog makes it easy to get data about traffic and usage of your Astro app. Integrating PostHog into your site enables analytics about user behavior, custom events capture, session recordings, feature flags, and more.

## Installation

In your \`src/components\` folder, create a \`posthog.astro\` file:

\`\`\`bash
cd ./src/components 
# or 'cd ./src && mkdir components && cd ./components' if your components folder doesn't exist 
touch posthog.astro
\`\`\`

In this file, add your PostHog initialization code. Be sure to include the \`is:inline\` directive to prevent Astro from processing it:

\`\`\`astro
---
// src/components/posthog.astro
---
<script is:inline>
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  posthog.init('PUBLIC_POSTHOG_KEY', {
    api_host: 'PUBLIC_POSTHOG_HOST',
  })
</script>
\`\`\`

## Layout Setup

Create a Layout where you will use \`posthog.astro\`. Create a new file \`PostHogLayout.astro\` in your \`src/layouts\` folder:

\`\`\`bash
cd ./src/layouts
# or 'cd ./src && mkdir layouts && cd ./layouts' if your layouts folder doesn't exist yet
touch PostHogLayout.astro
\`\`\`

Add the following code to \`PostHogLayout.astro\`:

\`\`\`astro
---
import PostHog from '../components/posthog.astro'
---
<html>
  <head>
    <PostHog />
  </head>
  <body>
    <slot />
  </body>
</html>
\`\`\`

## Update Your Pages

Update your pages to use the new Layout. For example, in \`src/pages/index.astro\`:

\`\`\`astro
---
import PostHogLayout from '../layouts/PostHogLayout.astro';
---
<PostHogLayout>
  <!-- your existing page content -->
  <h1>Welcome to Astro</h1>
</PostHogLayout>
\`\`\`

## Environment Variables

Make sure to set your environment variables in your \`.env\` file:

\`\`\`
PUBLIC_POSTHOG_KEY=your_project_api_key
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
\`\`\`

## Next Steps

- Call \`posthog.identify()\` when a user signs into your app
- Call \`posthog.capture()\` to capture custom events in your app
- Use feature flags with \`posthog.isFeatureEnabled()\`
- Set up session recordings and heatmaps
`;
}
