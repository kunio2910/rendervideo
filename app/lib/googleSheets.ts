export const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbylbUDCQZjsbVtWTb82KaNUICw_VySn7K3qSN3-51tnmgHJ2NM2zbiXUSLNDTjEIamqpg/exec";

export const GOOGLE_PROJECT_ID = "render-video-default";
const GOOGLE_SHEETS_API = "/api/google-sheets";

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
  const response = await fetch(GOOGLE_SHEETS_API, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId: GOOGLE_PROJECT_ID,
      data,
    }),
  });

  return readJsonResponse(response);
}

export async function loadDataFromGoogle() {
  const url = new URL(GOOGLE_SHEETS_API, window.location.origin);
  url.searchParams.set("projectId", GOOGLE_PROJECT_ID);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });
  const result = await readJsonResponse(response);

  return result.data;
}
