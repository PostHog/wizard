import { getAssetHostFromHost, getUiHostFromHost } from '../utils/urls';

export const getNextjsAppRouterDocs = ({
  host,
  language,
}: {
  host: string;
  language: 'typescript' | 'javascript';
}) => {
  return `
==============================
FILE: PostHogProvider.${
    language === 'typescript' ? 'tsx' : 'jsx'
  } (put it somewhere where client files are, like the components folder)
LOCATION: Wherever other providers are, or the components folder
==============================
Changes:
- Create a PostHogProvider component that will be imported into the layout file.

Example:
--------------------------------------------------
"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react"
import { Suspense, useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: "/ingest",
      ui_host: "${getUiHostFromHost(host)}",
      capture_pageview: 'history_change',
      capture_pageleave: true, // Enable pageleave capture
      capture_exceptions: true, // This enables capturing exceptions using Error Tracking, set to false if you don't want this
      debug: process.env.NODE_ENV === "development",
    })
  }, [])

  return (
    <PHProvider client={posthog}>
      <SuspendedPostHogPageView />
      {children}
    </PHProvider>
  )
}
--------------------------------------------------

==============================
FILE: layout.${language === 'typescript' ? 'tsx' : 'jsx'}
LOCATION: Wherever the root layout is
==============================
Changes:
- Import the PostHogProvider from the providers file and wrap the app in it.

Example:
--------------------------------------------------
// other imports
import { PostHogProvider } from "LOCATION_OF_POSTHOG_PROVIDER"

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <PostHogProvider>
          {/* other providers */}
          {children}
          {/* other providers */}
        </PostHogProvider>
      </body>
    </html>
  )
}
--------------------------------------------------

==============================
FILE: posthog.${language === 'typescript' ? 'ts' : 'js'}
LOCATION: Wherever works best given the project structure
==============================
Changes:
- Initialize the PostHog Node.js client

Example:
--------------------------------------------------
import { PostHog } from "posthog-node"

export default function PostHogClient() {
  const posthogClient = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    capture_pageview: 'history_change',
    flushAt: 1,
    flushInterval: 0,
  })
  return posthogClient
}
--------------------------------------------------

==============================
FILE: next.config.{js,ts,mjs,cjs}
LOCATION: Wherever the root next config is
==============================
Changes:
- Add rewrites to the Next.js config to support PostHog, if there are existing rewrites, add the PostHog rewrites to them.
- Add skipTrailingSlashRedirect to the Next.js config to support PostHog trailing slash API requests.
- This can be of type js, ts, mjs, cjs etc. You should adapt the file according to what extension it uses, and if it does not exist yet use '.js'.

Example:
--------------------------------------------------
const nextConfig = {
  // other config
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "${getAssetHostFromHost(host)}/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "${host}/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "${host}/decide",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
}
module.exports = nextConfig
--------------------------------------------------`;
};

export const getNextjsPagesRouterDocs = ({
  host,
  language,
}: {
  host: string;
  language: 'typescript' | 'javascript';
}) => {
  return `
==============================
FILE: _app.${language === 'typescript' ? 'tsx' : 'jsx'}
LOCATION: Wherever the root _app.${
    language === 'typescript' ? 'tsx' : 'jsx'
  } file is
==============================
Changes:
- Initialize PostHog in _app.js.
- Wrap the application in PostHogProvider.

Example:
--------------------------------------------------
import { useEffect } from "react"
import { Router } from "next/router"
import posthog from "posthog-js"
import { PostHogProvider } from "posthog-js/react"

export default function App({ Component, pageProps }) {
  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: "/ingest",
      ui_host: "${getUiHostFromHost(host)}",
      capture_pageview: 'history_change',
      capture_exceptions: true, // This enables capturing exceptions using Error Tracking, set to false if you don't want this
      loaded: (posthog) => {
        if (process.env.NODE_ENV === "development") posthog.debug()
      },
      debug: process.env.NODE_ENV === "development",
    })
  }, [])

  return (
    <PostHogProvider client={posthog}>
      <Component {...pageProps} />
    </PostHogProvider>
  )
}
--------------------------------------------------

==============================
FILE: posthog.${language === 'typescript' ? 'ts' : 'js'}
LOCATION: Wherever works best given the project structure
==============================
Changes:
- Initialize the PostHog Node.js client

Example:
--------------------------------------------------
import { PostHog } from "posthog-node"

export default function PostHogClient() {
  const posthogClient = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    capture_pageview: 'history_change',
    flushAt: 1,
    flushInterval: 0,
  })
  return posthogClient
}
--------------------------------------------------

==============================
FILE: next.config.{js,ts,mjs,cjs}
LOCATION: Wherever the root next config is
==============================
Changes:
- Add rewrites to the Next.js config to support PostHog, if there are existing rewrites, add the PostHog rewrites to them.
- Add skipTrailingSlashRedirect to the Next.js config to support PostHog trailing slash API requests.
- This can be of type js, ts, mjs, cjs etc. You should adapt the file according to what extension it uses, and if it does not exist yet use '.js'.

Example:
--------------------------------------------------
const nextConfig = {
  // other config
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "${getAssetHostFromHost(host)}/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "${host}/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "${host}/decide",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
}
module.exports = nextConfig
--------------------------------------------------`;
};

export const getModernNextjsDocs = ({
  host,
  language,
}: {
  host: string;
  language: 'typescript' | 'javascript';
}) => {
  return `
==============================
FILE: instrumentation-client.${language === 'typescript' ? 'ts' : 'js'} 
LOCATION: in the root of the application or inside an src folder.
==============================
Changes:
- Create or update the instrumentation-client.${
    language === 'typescript' ? 'tsx' : 'jsx'
  } file to use the PostHog client. If the file does not exist yet, create it.
- Do *not* import instrumentation-client.${
    language === 'typescript' ? 'tsx' : 'jsx'
  } in any other file; Next.js will automatically handle it.
- Do not modify any other pages/components in the Next.js application; the PostHog client will be automatically initialized and handle all pageview tasks on its own.

Example:
--------------------------------------------------

import posthog from "posthog-js"

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  api_host: "/ingest",
  ui_host: "${getUiHostFromHost(host)}",
  capture_pageview: 'history_change',
  capture_pageleave: true, // Enable pageleave capture
  capture_exceptions: true, // This enables capturing exceptions using Error Tracking, set to false if you don't want this
  debug: process.env.NODE_ENV === "development",
});
--------------------------------------------------

==============================
FILE: next.config.{js,ts,mjs,cjs}
LOCATION: Wherever the root next config is
==============================
Changes:
- Add rewrites to the Next.js config to support PostHog, if there are existing rewrites, add the PostHog rewrites to them.
- Add skipTrailingSlashRedirect to the Next.js config to support PostHog trailing slash API requests.
- This can be of type js, ts, mjs, cjs etc. You should adapt the file according to what extension it uses, and if it does not exist yet use '.js'.

Example:
--------------------------------------------------
const nextConfig = {
  // other config
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "${getAssetHostFromHost(host)}/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "${host}/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "${host}/decide",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
}
module.exports = nextConfig
--------------------------------------------------`;
};
