/**
 * FireTime Pro – Cloudflare Worker API gateway
 * Static UI: GitHub Pages. Data/authorization: Google Apps Script + Sheets.
 * No credential, password or service secret is stored in GitHub Pages.
 */
const MAX_BYTES = 3_700_000;
const MAX_RESPONSE_BYTES = 7_000_000;
const REQUEST_TYPES = new Set(['login', 'activate', 'logout', 'password', 'brand', 'api']);

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  };
}
function output(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type':'application/json; charset=utf-8', ...cors(origin)}
  });
}
function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function sign(secret, message) {
  const utf8 = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',utf8.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']
  );
  return hex(await crypto.subtle.sign('HMAC',key,utf8.encode(message)));
}
export default {
  async fetch(request, env) {
    const allowed = String(env.PUBLIC_ORIGIN || '').replace(/\/$/,'');
    const origin = request.headers.get('Origin') || '';
    const path = new URL(request.url).pathname;
    if (!allowed || !allowed.startsWith('https://')) {
      return new Response('Gateway origin not configured', {status:503});
    }
    if (origin !== allowed) {
      // This includes requests without Origin. CORS is NOT the authentication layer;
      // Apps Script independently verifies the signed request AND user session.
      return output({ok:false,error:'Origin nicht erlaubt.'},403,allowed);
    }
    if (path !== '/api') return output({ok:false,error:'Nicht gefunden.'},404,allowed);
    if (request.method === 'OPTIONS') {
      return new Response(null,{status:204,headers:cors(allowed)});
    }
    if (request.method !== 'POST') {
      return output({ok:false,error:'Nur POST erlaubt.'},405,allowed);
    }
    if (!env.GAS_WEBAPP_URL || !env.GAS_SHARED_KEY || env.GAS_SHARED_KEY.length < 48) {
      return output({ok:false,error:'Gateway nicht vollständig eingerichtet.'},503,allowed);
    }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(env.GAS_WEBAPP_URL)) {
      return output({ok:false,error:'Ungültige Backend-Adresse.'},503,allowed);
    }
    const length = Number(request.headers.get('content-length'));
    if (length && length > MAX_BYTES) {
      return output({ok:false,error:'Anfrage zu groß.'},413,allowed);
    }
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_BYTES) {
        return output({ok:false,error:'Anfrage zu groß.'},413,allowed);
      }
      const input = JSON.parse(raw);
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          !REQUEST_TYPES.has(input.type)) {
        return output({ok:false,error:'Ungültige Anfrage.'},400,allowed);
      }
      const payload = JSON.stringify(input);
      const ts = Math.floor(Date.now()/1000);
      const nonce = crypto.randomUUID().replaceAll('-','');
      const signature = await sign(env.GAS_SHARED_KEY, `${ts}.${nonce}.${payload}`);
      const backend = await fetch(env.GAS_WEBAPP_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ts,nonce,payload,signature}),
        redirect:'follow',
        signal:AbortSignal.timeout(25000)
      });
      if (!backend.ok) {
        return output({ok:false,error:'Google-Backend antwortet nicht korrekt.'},502,allowed);
      }
      const backendText = await backend.text();
      if (backendText.length > MAX_RESPONSE_BYTES) {
        return output({ok:false,error:'Backend-Antwort zu groß.'},502,allowed);
      }
      let result;
      try {result=JSON.parse(backendText);} catch(e) {
        return output({ok:false,error:'Backend liefert kein JSON. Ist die WebApp bereitgestellt?'},502,allowed);
      }
      if (!result || typeof result.ok !== 'boolean') {
        return output({ok:false,error:'Ungültige Antwort vom Backend.'},502,allowed);
      }
      return output(result,result.ok?200:(result.status||400),allowed);
    } catch(e) {
      return output({ok:false,error:'Verbindungsfehler zum Backend.'},502,allowed);
    }
  }
};
