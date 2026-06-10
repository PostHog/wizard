// proxy-from-env v2 ships no type declarations, so we maintain this by hand.
declare module 'proxy-from-env' {
  // Returns the proxy URL to use for the given URL, honouring the
  // HTTP_PROXY / HTTPS_PROXY / NO_PROXY environment variables (and their
  // lowercase variants). Returns an empty string when no proxy applies.
  export function getProxyForUrl(url: string): string;
}
