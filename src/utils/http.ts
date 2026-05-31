export interface HeaderCarrier {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
}

export function getHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  const candidate = headers?.[name.toLowerCase()];
  if (typeof candidate === "string") {
    return candidate;
  }

  return candidate?.[0];
}

export function getDefaultKeyFromHeaders(
  getHeader: (name: string) => string | null | undefined,
): string | undefined {
  const forwarded = getHeader("x-forwarded-for");
  if (forwarded && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim();
  }

  const realIp = getHeader("x-real-ip");
  if (realIp && realIp.length > 0) {
    return realIp.trim();
  }

  const cfConnectingIp = getHeader("cf-connecting-ip");
  if (cfConnectingIp && cfConnectingIp.length > 0) {
    return cfConnectingIp.trim();
  }

  return undefined;
}

export function getDefaultKeyFromRequest(request: HeaderCarrier): string | undefined {
  return (
    getDefaultKeyFromHeaders((name) => getHeaderValue(request.headers, name)) ??
    request.ip ??
    request.socket?.remoteAddress
  );
}

export function getDefaultKeyFromFetchRequest(request: Request): string | undefined {
  return (
    getDefaultKeyFromHeaders((name) => request.headers.get(name)) ??
    undefined
  );
}

export function shouldHandleMethod(
  method: string | undefined,
  methods: readonly string[] | undefined,
): boolean {
  if (!method) {
    return true;
  }

  const normalized = method.toUpperCase();
  const activeMethods = methods ?? ["POST", "PATCH", "PUT"];
  return activeMethods.includes(normalized);
}
