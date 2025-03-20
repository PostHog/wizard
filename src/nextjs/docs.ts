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
FILE: PostHogProvider.${language === 'typescript' ? 'tsx' : 'jsx'
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
      capture_pageview: false, // We capture pageviews manually
      capture_pageleave: true, // Enable pageleave capture
    })
  }, [])

  return (
    <PHProvider client={posthog}>
      <SuspendedPostHogPageView />
      {children}
    </PHProvider>
  )
}


function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const posthog = usePostHog()

  useEffect(() => {
    if (pathname && posthog) {
      let url = window.origin + pathname
      const search = searchParams.toString()
      if (search) {
        url += "?" + search
      }
      posthog.capture("$pageview", { "$current_url": url })
    }
  }, [pathname, searchParams, posthog])

  return null
}

function SuspendedPostHogPageView() {
  return (
    <Suspense fallback={null}>
      <PostHogPageView />
    </Suspense>
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
    host: "${host}",
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
LOCATION: Wherever the root _app.${language === 'typescript' ? 'tsx' : 'jsx'
    } file is
==============================
Changes:
- Initialize PostHog in _app.js.
- Wrap the application in PostHogProvider.
- Manually capture $pageview events.

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
      loaded: (posthog) => {
        if (process.env.NODE_ENV === "development") posthog.debug()
      },
    })

    const handleRouteChange = () => posthog?.capture("$pageview")
    Router.events.on("routeChangeComplete", handleRouteChange)

    return () => {
      Router.events.off("routeChangeComplete", handleRouteChange)
    }
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
    host: "${host}",
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
