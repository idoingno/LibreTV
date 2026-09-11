// functions/api/ia.js - Cloudflare Pages Function
// Internet Archive -> AppleCMS V10 适配器（CF 版）
// 仅收录 3 类 IA 集合：经典电影 / 动画 / 纪录片
//
// 路由：/api/ia?ac=videolist&wd=...&pg=N
//       /api/ia?ac=videolist&ids=<identifier>
// 返回：AppleCMS V10 JSON { code, msg, page, pagecount, limit, total, list:[vod_*] }
//
// 部署时浏览器通过 /proxy/ 调这个接口（前端 search.js 会自己套 PROXY_URL），
// 所以 vod_play_url 里给的是 *原始* IA m3u8/mp4 地址，播放器会再走 proxy 中转
// （CF proxy 能流式转发 mp4/ts 并透传 Range）。
//
// vod_pic 用 IA services.img 服务（archive.org 域名），浏览器访问 IA 直连会失败。
// 解决方案：vod_pic 给 *proxy 包装过*的路径，带 auth 参数，浏览器仍走 /proxy/。

const IA_BASE = 'https://archive.org';
const COLLECTIONS = [
    'feature_films',
    'animationandcartoons',
    'artsandmusicvideos',
    'documentaries',
    'classic_tv',
];
const DEFAULT_QUERY_FILTER = 'mediatype:movies AND -collection:librivoxaudio';

const UA = 'LibreTV-ia-adapter/1.0 (+https://archive.org) compatible';

// ---- 工具 ----

function jsonRes(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
        },
    });
}

function stripHtml(s) {
    return String(s || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function proxyWrapForPic(request, absUrl) {
    // 把 https://archive.org/services/img/xxx 包装成 /proxy/<encoded>?auth=...&t=...
    // 前端 ProxyAuth 会处理鉴权，所以这里只给干净的 /proxy/<encoded>，前端会再加。
    return `/proxy/${encodeURIComponent(absUrl)}`;
}

async function searchHandler(url, env) {
    const wd = (url.searchParams.get('wd') || '').trim();
    const pg = Math.max(1, parseInt(url.searchParams.get('pg') || '1', 10));
    const rows = 20;

    const colClause = COLLECTIONS.map((c) => `collection:${c}`).join(' OR ');
    const q = wd
        ? `(${wd}) AND (${colClause}) AND ${DEFAULT_QUERY_FILTER}`
        : `(${colClause}) AND ${DEFAULT_QUERY_FILTER}`;

    const params = new URLSearchParams();
    params.set('q', q);
    ['identifier', 'title', 'description', 'year', 'date', 'runtime', 'subject', 'collection', 'avg_rating', 'num_reviews']
        .forEach((f) => params.append('fl[]', f));
    params.set('sort[]', 'num_reviews desc');
    params.set('rows', String(rows));
    params.set('page', String(pg));
    params.set('output', 'json');

    const searchUrl = `${IA_BASE}/advancedsearch.php?${params.toString()}`;

    try {
        const r = await fetch(searchUrl, {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
        });
        if (!r.ok) {
            return jsonRes({ code: 0, msg: `IA 搜索失败: HTTP ${r.status}`, page: pg, pagecount: 0, limit: rows, total: 0, list: [] }, 502);
        }
        const data = await r.json();
        const numFound = data?.response?.numFound ?? 0;
        const docs = data?.response?.docs ?? [];

        const list = docs.map((doc) => {
            const id = doc.identifier;
            const year = doc.year || (doc.date ? String(doc.date).slice(0, 4) : '');
            return {
                vod_id: id,
                vod_name: doc.title || id,
                vod_pic: proxyWrapForPic(null, `${IA_BASE}/services/img/${encodeURIComponent(id)}`),
                vod_year: year,
                vod_area: '',
                vod_type: Array.isArray(doc.collection) ? doc.collection.filter((c) => COLLECTIONS.includes(c)).join(',') : '',
                vod_remarks: doc.runtime ? String(doc.runtime) : '',
                vod_content: stripHtml(doc.description),
                vod_play_from: 'archive',
                vod_play_url: '',
            };
        });

        return jsonRes({
            code: 1,
            msg: '数据列表',
            page: pg,
            pagecount: Math.max(1, Math.ceil(numFound / rows)),
            limit: rows,
            total: numFound,
            list,
        });
    } catch (err) {
        return jsonRes({ code: 0, msg: `IA 搜索失败: ${err.message}`, page: pg, pagecount: 0, limit: rows, total: 0, list: [] }, 502);
    }
}

function pickPlayableFiles(files = []) {
    const m3u8 = [];
    const mp4 = [];
    for (const f of files) {
        if (!f.name) continue;
        const n = String(f.name);
        if (/\.m3u8$/i.test(n)) m3u8.push(f);
        else if (/\.mp4$/i.test(n)) mp4.push(f);
    }
    return { m3u8, mp4 };
}

function buildPlayUrl(identifier, { m3u8, mp4 }) {
    const lines = [];
    m3u8.forEach((f, i) => {
        const label = f.name.includes('512kb') ? '流畅' : i === 0 ? '标准' : `线路${i + 1}`;
        lines.push(`${label}$${IA_BASE}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`);
    });
    mp4.slice(0, 3).forEach((f, i) => {
        lines.push(`MP4-${i + 1}$${IA_BASE}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`);
    });
    return lines.join('#');
}

async function detailHandler(url, env) {
    const ids = (url.searchParams.get('ids') || '').trim();
    if (!ids) return jsonRes({ code: 0, msg: '缺少 ids', list: [] });
    const id = ids.split(',')[0];

    try {
        const r = await fetch(`${IA_BASE}/metadata/${encodeURIComponent(id)}`, {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
        });
        if (r.status === 404) return jsonRes({ code: 0, msg: '条目不存在', list: [] }, 404);
        if (!r.ok) return jsonRes({ code: 0, msg: `IA HTTP ${r.status}`, list: [] }, 502);
        const meta = await r.json();
        const files = meta?.files || [];
        const { m3u8, mp4 } = pickPlayableFiles(files);
        if (!m3u8.length && !mp4.length) {
            return jsonRes({ code: 0, msg: '该条目无可播放文件', list: [] });
        }
        const m = meta?.metadata || {};
        const vod = {
            vod_id: id,
            vod_name: m.title || id,
            vod_pic: proxyWrapForPic(null, `${IA_BASE}/services/img/${encodeURIComponent(id)}`),
            vod_year: m.year || (m.date ? String(m.date).slice(0, 4) : ''),
            vod_area: m.country || '',
            vod_type: Array.isArray(m.subject) ? m.subject.slice(0, 5).join(',') : (m.subject || ''),
            vod_director: m.director || '',
            vod_actor: m.creator || '',
            vod_remarks: m.runtime ? String(m.runtime) : '',
            vod_content: stripHtml(m.description),
            vod_play_from: 'archive$$$backup',
            vod_play_url: buildPlayUrl(id, { m3u8, mp4 }),
            type_name: m.mediatype || 'movie',
        };
        return jsonRes({
            code: 1,
            msg: '数据列表',
            page: 1,
            pagecount: 1,
            limit: 1,
            total: 1,
            list: [vod],
        });
    } catch (err) {
        return jsonRes({ code: 0, msg: `IA 详情获取失败: ${err.message}`, list: [] }, 502);
    }
}

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    return url.searchParams.get('ids') ? detailHandler(url, context.env) : searchHandler(url, context.env);
}
