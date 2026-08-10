export const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbylbUDCQZjsbVtWTb82KaNUICw_VySn7K3qSN3-51tnmgHJ2NM2zbiXUSLNDTjEIamqpg/exec";

export const GOOGLE_PROJECT_ID = "render-video-default";
const GOOGLE_SHEETS_API = "/api/google-sheets";

async function requestGoogleSheetsProxy(
  proxyUrl: string,
  init: RequestInit,
) {
  try {
    const proxyResponse = await fetch(proxyUrl, init);
    const contentType = proxyResponse.headers.get("content-type")?.toLowerCase() || "";
    const proxyUnavailable =
      proxyResponse.status === 404
      || proxyResponse.status === 405
      || (proxyResponse.ok && !contentType.includes("application/json"));
    if (!proxyUnavailable) {
      return proxyResponse;
    }
  } catch {
    // Static hosts such as GitHub Pages do not expose the proxy route.
  }

  return null;
}

async function requestGoogleSheets(
  proxyUrl: string,
  directUrl: string,
  init: RequestInit,
) {
  const proxyResponse = await requestGoogleSheetsProxy(proxyUrl, init);
  if (proxyResponse) return proxyResponse;

  return fetch(directUrl, init);
}

async function readJsonResponse(response: Response) {
  let result: { success?: boolean; message?: string; [key: string]: unknown };
  try {
    result = await response.json();
  } catch {
    throw new Error(`Google Sheet trả về phản hồi không hợp lệ (HTTP ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(
      String(result.message || `Google Sheet trả về lỗi HTTP ${response.status}`),
    );
  }

  if (!result.success) {
    throw new Error(String(result.message || "Google Sheet xử lý thất bại"));
  }

  return result;
}

export async function saveDataToGoogle(data: unknown) {
  const body = JSON.stringify({
    projectId: GOOGLE_PROJECT_ID,
    data,
  });
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      Accept: "application/json",
      // Keep the direct Google Apps Script fallback as a CORS-simple request.
      // `application/json` triggers an OPTIONS preflight that Apps Script web
      // apps do not answer reliably, which surfaces as `Failed to fetch` on
      // static hosts such as GitHub Pages. The body is still JSON and is read
      // from `e.postData.contents` by the Apps Script endpoint.
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body,
  };
  const proxyUrl = new URL(GOOGLE_SHEETS_API, window.location.origin).toString();
  const proxyResponse = await requestGoogleSheetsProxy(proxyUrl, requestInit);
  if (proxyResponse) {
    const result = await readJsonResponse(proxyResponse);
    return { ...result, acknowledged: true };
  }

  try {
    // A normal save is initiated with fetch so the browser keeps the request
    // alive until the network layer has accepted it. `sendBeacon` resolves as
    // soon as the browser queues the request and can be dropped silently on
    // some static-host/browser combinations, which made saves look successful
    // without reaching Apps Script.
    await fetch(GOOGLE_SCRIPT_URL, {
      ...requestInit,
      mode: "no-cors",
      keepalive: true,
    });
    return { success: true, queued: true, transport: "fetch" };
  } catch (fetchError) {
    // Keep Beacon only as the unload-safe fallback when fetch cannot start.
    try {
      const queued = typeof navigator !== "undefined"
        && typeof navigator.sendBeacon === "function"
        && navigator.sendBeacon(
          GOOGLE_SCRIPT_URL,
          new Blob([body], { type: "text/plain;charset=UTF-8" }),
        );
      if (queued) return { success: true, queued: true, transport: "beacon" };
    } catch {
      // Re-throw the original fetch error below.
    }
    throw fetchError;
  }
}

async function loadGoogleResult() {
  const proxyUrl = new URL(GOOGLE_SHEETS_API, window.location.origin);
  proxyUrl.searchParams.set("projectId", GOOGLE_PROJECT_ID);
  const directUrl = new URL(GOOGLE_SCRIPT_URL);
  directUrl.searchParams.set("projectId", GOOGLE_PROJECT_ID);

  const response = await requestGoogleSheets(proxyUrl.toString(), directUrl.toString(), {
    method: "GET",
    cache: "no-store",
  });
  const result = await readJsonResponse(response);

  return result;
}

export async function loadGoogleSnapshot() {
  const result = await loadGoogleResult();

  return {
    data: result.data,
    updatedAt: typeof result.updatedAt === "string" ? result.updatedAt : "",
  };
}

export async function loadDataFromGoogle() {
  const snapshot = await loadGoogleSnapshot();
  return snapshot.data;
}
