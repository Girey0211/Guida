import type { Sinner } from "@/types/gameData";

export interface SinnerIdentityState {
  sinnerId: string;
  identityCodeIndex: number; // code_index (1-based, 기본 LCB = 1)
  order: number; // 편성 파티 순서 1~12 (미편성 0)
  egoZayinCodeIndex: number; // ZAYIN 에고 code_index (1-based, 기본 1)
  egoTethCodeIndex: number;  // TETH 에고 code_index (0-based, 없으면 0)
  egoHeCodeIndex: number;    // HE 에고 code_index (0-based, 없으면 0)
  egoWawCodeIndex: number;   // WAW 에고 code_index (0-based, 없으면 0)
}

export const SINNER_IDS_ORDER = [
  "yi_sang",
  "faust",
  "don_quixote",
  "ryoshu",
  "meursault",
  "hong_lu",
  "heathcliff",
  "ishmael",
  "rodion",
  "sinclair",
  "outis",
  "gregor"
];

// Gzip Compress using CompressionStream
async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(new Blob([data.buffer as ArrayBuffer])).body!
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Gzip Decompress using DecompressionStream
async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(new Blob([data.buffer as ArrayBuffer])).body!
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Base64 helper methods using browser standard
function base64ToBytes(base64: string): Uint8Array {
  const binString = atob(base64.replace(/\s/g, ""));
  return Uint8Array.from(binString, (m) => m.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binString);
}

// Bit manipulation helpers
function bytesToBitString(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(2).padStart(8, "0"))
    .join("");
}

function bitStringToBytes(bitStr: string): Uint8Array {
  const bytes = new Uint8Array(bitStr.length / 8);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bitStr.substring(i * 8, (i + 1) * 8), 2);
  }
  return bytes;
}

/** 12명 수감자 편성 상태를 게임 덱 공유 코드로 변환 */
export async function encodeDeckCode(states: SinnerIdentityState[], prisoners: Sinner[]): Promise<string> {
  let bitStr = "";
  for (const sinnerId of SINNER_IDS_ORDER) {
    const state = states.find(s => s.sinnerId === sinnerId) || {
      sinnerId,
      identityCodeIndex: 1,
      order: 0,
      egoZayinCodeIndex: 1,
      egoTethCodeIndex: 0,
      egoHeCodeIndex: 0,
      egoWawCodeIndex: 0
    };
    
    // 이 수감자의 에고 목록 정렬 (출시순)
    const sinnerMeta = prisoners.find(p => p.sinner_id === sinnerId);
    const sortedEgos = sinnerMeta 
      ? [...sinnerMeta.egos].sort((a, b) => a.release_date.localeCompare(b.release_date) || a.page_order - b.page_order)
      : [];
      
    // ZAYIN, TETH, HE, WAW 등급별로 장착된 에고가 sortedEgos에서 몇 번째 인덱스인지 찾습니다 (1-based)
    // ZAYIN 장착
    const zayinEgo = sinnerMeta?.egos.find(e => e.grade === "ZAYIN" && e.code_index === state.egoZayinCodeIndex);
    const zayinIdx = zayinEgo ? sortedEgos.findIndex(e => e.ego_id === zayinEgo.ego_id) + 1 : 1;
    
    // TETH 장착
    const tethEgo = sinnerMeta?.egos.find(e => e.grade === "TETH" && e.code_index === state.egoTethCodeIndex);
    const tethIdx = tethEgo ? sortedEgos.findIndex(e => e.ego_id === tethEgo.ego_id) + 1 : 0;
    
    // HE 장착
    const heEgo = sinnerMeta?.egos.find(e => e.grade === "HE" && e.code_index === state.egoHeCodeIndex);
    const heIdx = heEgo ? sortedEgos.findIndex(e => e.ego_id === heEgo.ego_id) + 1 : 0;
    
    // WAW 장착
    const wawEgo = sinnerMeta?.egos.find(e => e.grade === "WAW" && e.code_index === state.egoWawCodeIndex);
    const wawIdx = wawEgo ? sortedEgos.findIndex(e => e.ego_id === wawEgo.ego_id) + 1 : 0;

    // 46비트 블록 생성 (1-based 기준 비트 레이아웃)
    const r1 = "0000"; // 1-4 예약비트
    const identity = (state.identityCodeIndex || 1).toString(2).padStart(4, "0"); // 5-8
    const order = (state.order || 0).toString(2).padStart(4, "0"); // 9-12
    const r2 = "000"; // 13-15 예약비트
    const zayin = zayinIdx.toString(2).padStart(4, "0"); // 16-19
    const r3 = "000"; // 20-22 예약비트
    const teth = tethIdx.toString(2).padStart(4, "0"); // 23-26
    const r4 = "000"; // 27-29 예약비트
    const he = heIdx.toString(2).padStart(4, "0"); // 30-33
    const r5 = "000"; // 34-36 예약비트
    const waw = wawIdx.toString(2).padStart(4, "0"); // 37-40
    const r6 = "000000"; // 41-46 예약비트

    bitStr += (r1 + identity + order + r2 + zayin + r3 + teth + r4 + he + r5 + waw + r6);
  }
  
  // trailing 8 bits (트레일링 비트)
  bitStr += "00000000";
  
  // 비트열 -> 바이트 배열 -> Base64
  const bytes = bitStringToBytes(bitStr);
  const b64_1 = bytesToBase64(bytes);
  
  // Gzip 압축 -> Base64
  const compressed = await gzipCompress(new TextEncoder().encode(b64_1));
  const finalCode = bytesToBase64(compressed);
  
  return finalCode;
}

/** 게임 덱 공유 코드를 12명 수감자 편성 상태로 디코딩 */
export async function decodeDeckCode(deckCode: string, prisoners: Sinner[]): Promise<SinnerIdentityState[]> {
  try {
    if (!deckCode || !deckCode.trim() || prisoners.length === 0) {
      return createDefaultStates();
    }
    
    // Gzip 해제 및 Base64 디코드
    const compressed = base64ToBytes(deckCode.trim());
    const decompressed = await gzipDecompress(compressed);
    const b64_1 = new TextDecoder().decode(decompressed);
    const bytes = base64ToBytes(b64_1);
    
    let bitStr = bytesToBitString(bytes);
    if (bitStr.length < 560) {
      bitStr = bitStr.padStart(560, "0");
    }
    
    const states: SinnerIdentityState[] = [];
    for (let i = 0; i < 12; i++) {
      const sinnerId = SINNER_IDS_ORDER[i];
      const slotBase = i * 46;
      
      const identityVal = parseInt(bitStr.substring(slotBase + 4, slotBase + 8), 2);
      const orderVal = parseInt(bitStr.substring(slotBase + 8, slotBase + 12), 2);
      
      // 덱 코드에서 읽은 에고 전체 출시 순서 index (1-based)
      const zayinIdx = parseInt(bitStr.substring(slotBase + 15, slotBase + 19), 2);
      const tethIdx = parseInt(bitStr.substring(slotBase + 22, slotBase + 26), 2);
      const heIdx = parseInt(bitStr.substring(slotBase + 29, slotBase + 33), 2);
      const wawIdx = parseInt(bitStr.substring(slotBase + 36, slotBase + 40), 2);
      
      const sinnerMeta = prisoners.find(p => p.sinner_id === sinnerId);
      const sortedEgos = sinnerMeta
        ? [...sinnerMeta.egos].sort((a, b) => a.release_date.localeCompare(b.release_date) || a.page_order - b.page_order)
        : [];
        
      // 정렬된 에고 리스트에서 1-based index로 에고를 찾아, 그 에고의 grade별 code_index를 가져옵니다.
      const zayinEgo = zayinIdx > 0 ? sortedEgos[zayinIdx - 1] : null;
      const tethEgo = tethIdx > 0 ? sortedEgos[tethIdx - 1] : null;
      const heEgo = heIdx > 0 ? sortedEgos[heIdx - 1] : null;
      const wawEgo = wawIdx > 0 ? sortedEgos[wawIdx - 1] : null;
      
      states.push({
        sinnerId,
        identityCodeIndex: identityVal || 1,
        order: orderVal || 0,
        egoZayinCodeIndex: zayinEgo?.code_index || 1,
        egoTethCodeIndex: tethEgo?.code_index || 0,
        egoHeCodeIndex: heEgo?.code_index || 0,
        egoWawCodeIndex: wawEgo?.code_index || 0
      });
    }
    return states;
  } catch (e) {
    console.error("[deckCode] 덱 코드 복호화 실패 — 기본 스플릿 상태로 대체", e);
    return createDefaultStates();
  }
}

export function createDefaultStates(): SinnerIdentityState[] {
  return SINNER_IDS_ORDER.map(sinnerId => ({
    sinnerId,
    identityCodeIndex: 1,
    order: 0,
    egoZayinCodeIndex: 1,
    egoTethCodeIndex: 0,
    egoHeCodeIndex: 0,
    egoWawCodeIndex: 0
  }));
}
