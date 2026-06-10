import { requestUrl } from "obsidian";

/**
 * GitHub OAuth Device Flow.
 *
 * Lets the user sign in via the browser (no PAT) — the plugin receives an
 * OAuth access token. Crucially, OAuth tokens are treated as a different actor
 * than PATs by GitHub rulesets, so this can satisfy enterprise rules that block
 * PAT pushes (the same reason native git / git-credential-manager works).
 *
 * Requires a GitHub OAuth App client id with "Device flow" enabled. No client
 * secret is needed for the device flow.
 */

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

export interface DeviceCodeInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface DeviceFlowHandlers {
  /** Called once the user code + verification URL are available. */
  onPrompt: (info: DeviceCodeInfo) => void;
  /** Optional: allow cancellation. Return true to abort polling. */
  isCancelled?: () => boolean;
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, string>> {
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const res = await requestUrl({
    url,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    throw: false,
  });
  try {
    return res.json as Record<string, string>;
  } catch {
    throw new Error(`Unexpected response (HTTP ${res.status}) from ${url}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the full device flow. Resolves with the OAuth access token.
 * `scope` is space-separated (e.g. "repo").
 */
export async function deviceFlowAuthenticate(
  clientId: string,
  scope: string,
  handlers: DeviceFlowHandlers,
): Promise<string> {
  if (!clientId) throw new Error("OAuth Client ID is not set.");

  const start = (await postForm(DEVICE_CODE_URL, {
    client_id: clientId,
    scope,
  })) as unknown as DeviceCodeInfo & { error?: string; error_description?: string };

  if (start.error) {
    throw new Error(
      `Device code request failed: ${start.error_description || start.error}`,
    );
  }
  if (!start.device_code || !start.user_code) {
    throw new Error("Device code request returned an unexpected response.");
  }

  handlers.onPrompt(start);

  const deadline = Date.now() + (start.expires_in || 900) * 1000;
  let intervalMs = (start.interval || 5) * 1000;

  while (Date.now() < deadline) {
    if (handlers.isCancelled?.()) {
      throw new Error("Sign-in cancelled.");
    }
    await sleep(intervalMs);

    const poll = await postForm(ACCESS_TOKEN_URL, {
      client_id: clientId,
      device_code: start.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    if (poll.access_token) {
      return poll.access_token;
    }
    switch (poll.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        intervalMs += 5000;
        break;
      case "expired_token":
        throw new Error("The device code expired. Please try signing in again.");
      case "access_denied":
        throw new Error("Sign-in was denied.");
      case "unsupported_grant_type":
      case "incorrect_client_credentials":
      case "incorrect_device_code":
        throw new Error(
          `Sign-in failed: ${poll.error_description || poll.error}`,
        );
      default:
        if (poll.error) {
          throw new Error(
            `Sign-in failed: ${poll.error_description || poll.error}`,
          );
        }
    }
  }
  throw new Error("Sign-in timed out. Please try again.");
}
