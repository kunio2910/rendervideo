import { GOOGLE_PROJECT_ID, GOOGLE_SCRIPT_URL } from "../../lib/googleSheets";

type GoogleSheetsPayload = {
  success?: boolean;
  message?: string;
  [key: string]: unknown;
};

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

const jsonResponse = (payload: GoogleSheetsPayload, status = 200) =>
  Response.json(payload, { status, headers: jsonHeaders });

async function forwardToGoogle(targetUrl: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(targetUrl, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        message: error instanceof Error
          ? `Không thể kết nối Google Sheet: ${error.message}`
          : "Không thể kết nối Google Sheet.",
      },
      502,
    );
  }

  let payload: GoogleSheetsPayload;
  try {
    payload = await response.json() as GoogleSheetsPayload;
  } catch {
    return jsonResponse(
      {
        success: false,
        message: `Google Sheet trả về phản hồi không hợp lệ (HTTP ${response.status}).`,
      },
      502,
    );
  }

  if (!response.ok) {
    return jsonResponse(
      {
        ...payload,
        success: false,
        message: String(payload.message || `Google Sheet trả về lỗi HTTP ${response.status}.`),
      },
      502,
    );
  }

  if (payload.success === false) {
    return jsonResponse(payload, 502);
  }

  return jsonResponse(payload);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const projectId = requestUrl.searchParams.get("projectId")?.trim() || GOOGLE_PROJECT_ID;
  const targetUrl = new URL(GOOGLE_SCRIPT_URL);
  targetUrl.searchParams.set("projectId", projectId);
  return forwardToGoogle(targetUrl.toString(), { method: "GET" });
}

export async function POST(request: Request) {
  const body = await request.text();
  if (!body.trim()) {
    return jsonResponse({ success: false, message: "Thiếu dữ liệu cần lưu lên Google Sheet." }, 400);
  }

  try {
    JSON.parse(body);
  } catch {
    return jsonResponse({ success: false, message: "Dữ liệu lưu không phải JSON hợp lệ." }, 400);
  }

  return forwardToGoogle(GOOGLE_SCRIPT_URL, {
    method: "POST",
    body,
  });
}
