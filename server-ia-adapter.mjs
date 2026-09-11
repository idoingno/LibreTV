// Internet Archive → AppleCMS V10 适配器
// 用法：在 server.mjs 里 `import { registerIaRoutes } from './server-ia-adapter.mjs'`
// 提供 `/api/ia` 路由，响应 AppleCMS V10 JSON
//
// 仅收录 3 个 IA 集合（用户指定：经典电影、动画、纪录片）：
//   - feature_films （经典老片，含 Night of the Living Dead / Metropolis / Charade 等）
//   - animationandcartoons （老动画）
//   - artsandmusicvideos / documentaries / classic_tv （纪录片/艺术类）
//
// metadata 的播放地址：优先用 IA 自动生成的 m3u8 (listing)，不存在则退回 mp4
// 文件（前端 player.js 已加 mp4 分支）。

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

const IA_BASE = 'https://archive.org';
const IA_SEARCH_URL = `${IA_BASE}/advancedsearch.php`;
const IA_METADATA_URL = (id) => `${IA_BASE}/metadata/${encodeURIComponent(id)}`;
const IA_COVER_URL = (id) => `${IA_BASE}/services/img/${encodeURIComponent(id)}`;

// IA 在国内直连受限；如果设了 HTTPS_PROXY（或等价变量）通过代理访问
const PROXY_URL =
  process.env.IA_HTTPS_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.ALL_PROXY ||
  process.env.all_proxy ||
  '';
const httpsAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;
if (PROXY_URL && process.env.DEBUG === 'true') {
  console.log(`[IA adapter] 使用代理 ${PROXY_URL.replace(/\/\/([^:@]+):([^@]+)@/, '//***:***@')}`);
}

// 经典电影 / 动画 / 纪录片 三类集合
const COLLECTIONS = [
  'feature_films',
  'animationandcartoons',
  'artsandmusicvideos',
  'documentaries',
  'classic_tv',
];

// 过滤"明显不能看"的：仅保留 mediatype:movies && 不隐藏 && 不 private
const DEFAULT_QUERY_FILTER =
  'mediatype:movies AND -collection:librivoxaudio';

// 简单内存缓存（TTL 10 分钟）
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.v;
}
function cacheSet(key, v) {
  if (cache.size > 500) cache.clear(); // 防止膨胀
  cache.set(key, { t: Date.now(), v });
}

const UA =
  'LibreTV-ia-adapter/1.0 (+https://archive.org) Mozilla/5.0 (compatible)';

async function iaSearch(wd, page = 1, rows = 20) {
  const colClause = COLLECTIONS.map((c) => `collection:${c}`).join(' OR ');
  const q = wd
    ? `(${wd}) AND (${colClause}) AND ${DEFAULT_QUERY_FILTER}`
    : `(${colClause}) AND ${DEFAULT_QUERY_FILTER}`;

  const params = {
    q,
    'fl[]': ['identifier', 'title', 'description', 'year', 'date', 'runtime', 'language', 'subject', 'collection', 'avg_rating', 'num_reviews'],
    'sort[]': 'num_reviews desc',
    rows,
    page,
    output: 'json',
  };

  const cacheKey = `search:${JSON.stringify(params)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const { data } = await axios.get(IA_SEARCH_URL, {
    params,
    timeout: 15000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    httpsAgent,
    proxy: false, // 禁用 axios 自带 proxy，由 httpsAgent 接管
    paramsSerializer: (p) => {
      // axios 默认 serializer 会把 fl[] 全部展平成重复 key，正是 IA 需要的格式
      return Object.entries(p)
        .flatMap(([k, v]) =>
          Array.isArray(v) ? v.map((vv) => `${encodeURIComponent(k)}=${encodeURIComponent(vv)}`) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
        )
        .join('&');
    },
  });

  const v = {
    numFound: data?.response?.numFound ?? 0,
    docs: data?.response?.docs ?? [],
  };
  cacheSet(cacheKey, v);
  return v;
}

async function iaMetadata(id) {
  const cacheKey = `meta:${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const { data } = await axios.get(IA_METADATA_URL(id), {
    timeout: 15000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    httpsAgent,
    proxy: false,
  });
  cacheSet(cacheKey, data);
  return data;
}

function pickPlayableFiles(files = []) {
  // files: [ {name, format, length, title, ...}, ... ]
  const m3u8 = [];
  const mp4 = [];
  for (const f of files) {
    if (!f.name) continue;
    const n = String(f.name);
    // IA 为多数 item 生成 "<identifier>[_512kb].mp4" 和 "<identifier>.m3u8"
    // m3u8 会出现两条（原始 + 512kb)，我们都留，前端 player 会按顺序
    if (/\.m3u8$/i.test(n)) m3u8.push(f);
    else if (/\.mp4$/i.test(n)) mp4.push(f);
  }
  return { m3u8, mp4 };
}

function buildPlayUrl(identifier, { m3u8, mp4 }) {
  // 返回 AppleCMS 的 vod_play_url 字段值："集名$URL#集名$URL"
  // 前端只会 split('$$$') 然后 split('#') 然后 split('$') 取 parts[1]
  // 所以 '线路1$m3u8#线路2$mp4' 是合法的
  const lines = [];
  m3u8.forEach((f, i) => {
    const label = f.name.includes('512kb') ? `流畅` : i === 0 ? '标准' : `线路${i + 1}`;
    lines.push(`${label}$${IA_BASE}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`);
  });
  mp4.slice(0, 3).forEach((f, i) => {
    lines.push(`MP4-${i + 1}$${IA_BASE}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`);
  });
  return lines.join('#');
}

function docToVod(doc) {
  const id = doc.identifier;
  const year = doc.year || (doc.date ? String(doc.date).slice(0, 4) : '');
  const desc = (doc.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    vod_id: id,
    vod_name: doc.title || id,
    vod_pic: IA_COVER_URL(id),
    vod_year: year,
    vod_area: '',
    vod_type: doc.collection?.filter?.((c) => COLLECTIONS.includes(c))?.join(',') || '',
    vod_remarks: doc.runtime ? String(doc.runtime) : '',
    vod_content: desc,
    // 详情页才补 play_url；搜索页放些占位以通过前端 list 判空
    vod_play_from: 'archive',
    vod_play_url: '',
  };
}

async function searchHandler(req, res) {
  const wd = String(req.query.wd || '').trim();
  const pg = Math.max(1, parseInt(req.query.pg || '1', 10));
  const rows = 20;

  try {
    const { numFound, docs } = await iaSearch(wd, pg, rows);
    const list = docs.map(docToVod);
    res.json({
      code: 1,
      msg: '数据列表',
      page: pg,
      pagecount: Math.max(1, Math.ceil(numFound / rows)),
      limit: rows,
      total: numFound,
      list,
    });
  } catch (err) {
    res.status(502).json({
      code: 0,
      msg: `IA 搜索失败: ${err.message}`,
      page: pg,
      pagecount: 0,
      limit: rows,
      total: 0,
      list: [],
    });
  }
}

async function detailHandler(req, res) {
  const idsParam = String(req.query.ids || '').trim();
  if (!idsParam) return res.json({ code: 0, msg: '缺少 ids', list: [] });
  const id = idsParam.split(',')[0];

  try {
    const meta = await iaMetadata(id);
    const files = meta?.files || [];
    const { m3u8, mp4 } = pickPlayableFiles(files);
    if (!m3u8.length && !mp4.length) {
      return res.json({ code: 0, msg: '该条目无可播放文件', list: [] });
    }

    const m = meta?.metadata || {};
    const desc = String(m.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const vod = {
      vod_id: id,
      vod_name: m.title || id,
      vod_pic: IA_COVER_URL(id),
      vod_year: m.year || (m.date ? String(m.date).slice(0, 4) : ''),
      vod_area: m.country || '',
      vod_type: Array.isArray(m.subject) ? m.subject.slice(0, 5).join(',') : m.subject || '',
      vod_director: m.director || '',
      vod_actor: m.creator || '',
      vod_remarks: m.runtime ? String(m.runtime) : '',
      vod_content: desc,
      vod_play_from: 'archive$$$backup',
      vod_play_url: buildPlayUrl(id, { m3u8, mp4 }),
      type_name: m.mediatype || 'movie',
    };
    res.json({
      code: 1,
      msg: '数据列表',
      page: 1,
      pagecount: 1,
      limit: 1,
      total: 1,
      list: [vod],
    });
  } catch (err) {
    const status = err.response?.status;
    res.status(status === 404 ? 404 : 502).json({
      code: 0,
      msg: `IA 详情获取失败: ${err.message}`,
      list: [],
    });
  }
}

export function registerIaRoutes(app) {
  app.get('/api/ia', async (req, res) => {
    const ac = String(req.query.ac || 'videolist');
    // 同一端点同时处理搜索和详情；前端 search.js / api.js 都用 ac=videolist
    if (req.query.ids) {
      await detailHandler(req, res);
    } else {
      await searchHandler(req, res);
    }
  });
}
