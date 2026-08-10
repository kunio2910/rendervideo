export const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbylbUDCQZjsbVtWTb82KaNUICw_VySn7K3qSN3-51tnmgHJ2NM2zbiXUSLNDTjEIamqpg/exec";

export const GOOGLE_PROJECT_ID = "render-video-default";
const GOOGLE_SHEETS_API = "/api/google-sheets";

async function requestGoogleSheets(
  proxyUrl: string,
  directUrl: string,
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
    body: JSON.stringify({
      projectId: GOOGLE_PROJECT_ID,
      data,
    }),
  };
  const proxyUrl = new URL(GOOGLE_SHEETS_API, window.location.origin).toString();
  const response = await requestGoogleSheets(proxyUrl, GOOGLE_SCRIPT_URL, requestInit);

  return readJsonResponse(response);
}

export async function loadDataFromGoogle() {
  const proxyUrl = new URL(GOOGLE_SHEETS_API, window.location.origin);
  proxyUrl.searchParams.set("projectId", GOOGLE_PROJECT_ID);
  const directUrl = new URL(GOOGLE_SCRIPT_URL);
  directUrl.searchParams.set("projectId", GOOGLE_PROJECT_ID);

  const response = await requestGoogleSheets(proxyUrl.toString(), directUrl.toString(), {
    method: "GET",
    cache: "no-store",
  });
  const result = await readJsonResponse(response);

  return result.data;
}
