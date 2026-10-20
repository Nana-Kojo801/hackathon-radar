/**
 * Plain-language reasons for a failed request or browser call, so the app says
 * what's actually wrong instead of blaming "the server" for everything.
 */

export interface Explained {
  /** One sentence for the user. */
  text: string;
  /** The server answered, but doesn't have this yet: it's running an older version. */
  outdated: boolean;
}

export function explainError(e: unknown, what = "this"): Explained {
  const status = (e as { status?: number } | null)?.status;
  if (status === 404)
    return { text: `The server doesn't have ${what} yet: it's running an older version. Redeploy the API on Render to update it.`, outdated: true };
  if (status === 401) return { text: "The server didn't accept this device's key. Reconnect in Settings.", outdated: false };
  if (status === 403) return { text: "The server refused the request (403).", outdated: false };
  if (status && status >= 500) return { text: `The server hit an error (${status}). It may be restarting; try again in a minute.`, outdated: false };
  const name = (e as { name?: string } | null)?.name;
  if (name === "AbortError") return { text: "Your phone's push service didn't answer. Check your connection and Google Play services, then try again.", outdated: false };
  if (name === "NotAllowedError") return { text: "Notifications are blocked for this app. Allow them in your phone's settings.", outdated: false };
  if (name === "InvalidStateError") return { text: "A notification subscription from an older setup is in the way. Turn it off and on again.", outdated: false };
  if (name === "NotSupportedError" || name === "SecurityError") return { text: "This browser can't do push notifications here. Try the installed app.", outdated: false };
  if (name === "TimeoutError" || e instanceof TypeError) return { text: "Couldn't reach the server. It may be waking up (up to a minute); try again.", outdated: false };
  return { text: `Something went wrong${e instanceof Error && e.message ? ` (${e.message})` : ""}. Try again.`, outdated: false };
}
