export interface HttpResponseSnapshot {
  body: string;
  bodyKind: "empty" | "json" | "text";
  headers: Record<string, string>;
  statusCode: number;
}

export function addIdempotencyHeaders(
  headers: Headers,
  key: string,
  status: "created" | "cached",
): Headers {
  const next = new Headers(headers);
  next.set("idempotency-key", key);
  next.set("idempotency-status", status);
  return next;
}

export async function responseToSnapshot(response: Response): Promise<HttpResponseSnapshot> {
  const cloned = response.clone();
  const headers: Record<string, string> = {};
  cloned.headers.forEach((value, name) => {
    headers[name] = value;
  });

  const body = await cloned.text();
  return {
    body,
    bodyKind: inferBodyKind(headers["content-type"]),
    headers,
    statusCode: cloned.status,
  };
}

export function responseFromSnapshot(
  snapshot: HttpResponseSnapshot,
  key: string,
  status: "created" | "cached",
): Response {
  return new Response(snapshot.body, {
    status: snapshot.statusCode,
    headers: addIdempotencyHeaders(new Headers(snapshot.headers), key, status),
  });
}

export function buildSnapshotFromValue(
  value: unknown,
  statusCode = 200,
  headers: Record<string, string> = {},
): HttpResponseSnapshot {
  if (value === undefined) {
    return {
      body: "",
      bodyKind: "empty",
      headers,
      statusCode,
    };
  }

  if (typeof value === "string") {
    return {
      body: value,
      bodyKind: "text",
      headers,
      statusCode,
    };
  }

  const nextHeaders = { ...headers };
  if (!nextHeaders["content-type"]) {
    nextHeaders["content-type"] = "application/json; charset=utf-8";
  }

  return {
    body: JSON.stringify(value),
    bodyKind: "json",
    headers: nextHeaders,
    statusCode,
  };
}

function inferBodyKind(contentType: string | undefined): "empty" | "json" | "text" {
  if (!contentType) {
    return "text";
  }

  return contentType.includes("application/json") ? "json" : "text";
}
