// 响应工具：错误统一为 { code, msg, path, timestamp }，与 Petrichor 前端的解析方式一致。

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
}

export function withSecurityHeaders(response: Response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) response.headers.set(name, value)
  }
  return response
}

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...init.headers },
  })
}

export function errorResponse(status: number, message: string, pathname: string) {
  return json({ code: status, msg: message, path: pathname, timestamp: new Date().toISOString() }, { status })
}

/** 读取请求体，超过上限立即中止，避免大请求耗尽内存。 */
export async function readBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, `请求体超过 ${maxBytes} 字节`)
  if (!request.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of request.body) {
    total += chunk.byteLength
    if (total > maxBytes) throw new HttpError(413, `请求体超过 ${maxBytes} 字节`)
    chunks.push(chunk)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export async function readJson(request: Request, maxBytes = 2 * 1024 * 1024): Promise<Record<string, unknown>> {
  const body = await readBody(request, maxBytes)
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // 统一按格式错误处理
  }
  throw new HttpError(400, "请求体必须是 JSON 对象")
}

export function clientIp(request: Request, server: { requestIP(request: Request): { address: string } | null } | null, trustProxy: boolean) {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    if (forwarded) return forwarded
  }
  return server?.requestIP(request)?.address ?? "unknown"
}
