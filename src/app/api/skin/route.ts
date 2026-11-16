import { Buffer } from "node:buffer";

export const runtime = "nodejs";

const USERNAME = /^[a-zA-Z0-9_]{3,16}$/;
const UUID = /^[a-f0-9]{32}$/i;
const MAX_SKIN_BYTES = 2 * 1024 * 1024;
const UPSTREAM_ERROR = "Сервис скинов Minecraft сейчас недоступен. Попробуйте позже или загрузите PNG.";

class SkinError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SkinError(502, UPSTREAM_ERROR);
  return value as Record<string, unknown>;
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new SkinError(502, UPSTREAM_ERROR);
  if (!response.body) throw new SkinError(502, UPSTREAM_ERROR);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new SkinError(502, UPSTREAM_ERROR);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

async function upstream(url: string, signal: AbortSignal, accept = "application/json") {
  const response = await fetch(url, {
    headers: { Accept: accept },
    signal,
    redirect: "error",
    next: { revalidate: 900 },
  });
  if (response.status === 404 || response.status === 204) throw new SkinError(404, "Игрок с таким никнеймом не найден в Minecraft Java Edition.");
  if (response.status === 429) throw new SkinError(429, "Слишком много запросов к Minecraft. Подождите немного и попробуйте снова.");
  if (!response.ok) throw new SkinError(502, UPSTREAM_ERROR);
  return response;
}

async function json(url: string, signal: AbortSignal) {
  const response = await upstream(url, signal);
  return record(JSON.parse((await readLimited(response, 128 * 1024)).toString("utf8")));
}

/** Public Java profiles only; all upstream URLs are fixed Minecraft services. */
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
  if (!USERNAME.test(name)) return Response.json({ error: "Введите Java-никнейм: от 3 до 16 латинских букв, цифр или символов _." }, { status: 400 });

  const timeout = AbortSignal.timeout(15_000);
  const signal = AbortSignal.any([timeout, request.signal]);
  try {
    const player = await json(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, signal);
    if (typeof player.id !== "string" || !UUID.test(player.id) || typeof player.name !== "string" || !USERNAME.test(player.name) || player.name.toLowerCase() !== name.toLowerCase()) {
      throw new SkinError(502, UPSTREAM_ERROR);
    }
    const profile = await json(`https://sessionserver.mojang.com/session/minecraft/profile/${player.id}`, signal);
    if (profile.id !== player.id || typeof profile.name !== "string" || profile.name.toLowerCase() !== player.name.toLowerCase() || !Array.isArray(profile.properties)) {
      throw new SkinError(502, UPSTREAM_ERROR);
    }
    const property = profile.properties.find((value: unknown) => value && typeof value === "object" && (value as Record<string, unknown>).name === "textures");
    const encoded = property && record(property).value;
    if (typeof encoded !== "string" || encoded.length > 100_000 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) throw new SkinError(502, UPSTREAM_ERROR);
    const textures = record(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
    if (textures.profileId !== undefined && textures.profileId !== player.id) throw new SkinError(502, UPSTREAM_ERROR);
    const skinValue = record(textures.textures).SKIN;
    if (!skinValue) throw new SkinError(404, "У этого игрока нет собственного скина. Загрузите PNG скина с устройства.");
    const skin = record(skinValue);
    if (typeof skin.url !== "string") throw new SkinError(502, UPSTREAM_ERROR);
    const textureUrl = new URL(skin.url);
    if (!/^(http|https):$/.test(textureUrl.protocol) || textureUrl.hostname !== "textures.minecraft.net" || textureUrl.port || textureUrl.username || textureUrl.password || textureUrl.search || textureUrl.hash || !/^\/texture\/[a-f0-9]{32,64}$/i.test(textureUrl.pathname)) {
      throw new SkinError(502, UPSTREAM_ERROR);
    }
    const response = await upstream(`https://textures.minecraft.net${textureUrl.pathname}`, signal, "image/png");
    const bytes = await readLimited(response, MAX_SKIN_BYTES);
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) !== 64 || ![32, 64].includes(bytes.readUInt32BE(20))) {
      throw new SkinError(502, "Minecraft вернул скин неподходящего формата. Загрузите PNG размером 64 × 64 или 64 × 32.");
    }
    const metadata = skin.metadata ? record(skin.metadata) : undefined;
    return Response.json({
      skin: `data:image/png;base64,${bytes.toString("base64")}`,
      name: player.name,
      slim: metadata?.model === "slim",
    }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof SkinError) return Response.json({ error: error.message }, { status: error.status });
    if (signal.aborted) return Response.json({ error: "Minecraft не ответил вовремя. Попробуйте ещё раз или загрузите PNG с устройства." }, { status: 504 });
    return Response.json({ error: UPSTREAM_ERROR }, { status: 502 });
  }
}
