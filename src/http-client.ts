import { requestUrl } from "obsidian";
import type { HttpClient } from "isomorphic-git";

/**
 * isomorphic-git HTTP client backed by Obsidian's `requestUrl`.
 *
 * Using `requestUrl` (instead of the browser `fetch` shipped with
 * isomorphic-git/http/web) avoids CORS restrictions on mobile, where requests
 * to github.com would otherwise be blocked.
 */

interface GitHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: AsyncIterableIterator<Uint8Array> | Uint8Array[];
}

interface GitHttpResponse {
  url: string;
  method?: string;
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: Uint8Array[];
}

async function collectBody(
  body?: AsyncIterableIterator<Uint8Array> | Uint8Array[],
): Promise<ArrayBuffer | undefined> {
  if (!body) return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return new ArrayBuffer(0);
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

const httpImpl = {
  async request(req: GitHttpRequest): Promise<GitHttpResponse> {
    const { url, method = "GET", headers = {} } = req;
    const body = await collectBody(req.body);

    const res = await requestUrl({
      url,
      method,
      headers,
      body: body,
      contentType: headers["content-type"] || headers["Content-Type"],
      throw: false,
    });

    const resHeaders: Record<string, string> = {};
    for (const key of Object.keys(res.headers || {})) {
      resHeaders[key.toLowerCase()] = res.headers[key];
    }

    return {
      url,
      method,
      statusCode: res.status,
      statusMessage: String(res.status),
      headers: resHeaders,
      body: [new Uint8Array(res.arrayBuffer)],
    };
  },
};

export const http = httpImpl as unknown as HttpClient;
