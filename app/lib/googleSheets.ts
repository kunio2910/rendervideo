export const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbylbUDCQZjsbVtWTb82KaNUICw_VySn7K3qSN3-51tnmgHJ2NM2zbiXUSLNDTjEIamqpg/exec";

export const GOOGLE_PROJECT_ID = "render-video-default";

async function readJsonResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Google Apps Script trả về lỗi HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || "Google Apps Script xử lý thất bại");
  }

  return result;
}

export async function saveDataToGoogle(data: unknown) {
  const response = await fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({
      projectId: GOOGLE_PROJECT_ID,
      data,
    }),
  });

  return readJsonResponse(response);
}

export async function loadDataFromGoogle() {
  const url = new URL(GOOGLE_SCRIPT_URL);
  url.searchParams.set("projectId", GOOGLE_PROJECT_ID);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });
  const result = await readJsonResponse(response);

  return result.data;
}
