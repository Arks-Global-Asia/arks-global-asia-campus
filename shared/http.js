export async function readApiResponse(response) {
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    // Azure returns HTML when no API is deployed. Never expose the HTML parser error
    // or send the visitor to a sign-in route belonging to another hosting service.
    const error = new Error(
      "The campus service is not available yet. Please try again shortly or contact your institute.",
    );
    error.status = 503;
    error.code = "API_UNAVAILABLE";
    throw error;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Object.assign(
      new Error(
        "The campus service returned an invalid response. Please try again.",
      ),
      { status: 503, code: "API_UNAVAILABLE" },
    );
  }
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "The request could not be completed."),
      { status: response.status, code: data.code },
    );
  return data;
}
