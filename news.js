// Agrégateur d'actualités : lit des flux RSS/Atom (config/feeds.json), met en cache 1 h.
const fs = require('fs');
const path = require('path');

const FEEDS_FILE = path.join(__dirname, 'config', 'feeds.json');
const CACHE_MS = 60 * 60 * 1000;
let cache = { at: 0, items: [], errors: [] };

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function parseFeed(xml, feed) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 15)) {
    let link = decode(tag(b, 'link'));
    if (!link) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      link = m ? m[1] : '';
    }
    const date = new Date(decode(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date')));
    let summary = decode(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'));
    if (summary.length > 260) summary = summary.slice(0, 257) + '…';
    const title = decode(tag(b, 'title'));
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({
      title, link, summary,
      date: isNaN(date) ? null : date.toISOString(),
      source: feed.name, category: feed.category,
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(feed.url, { signal: ctrl.signal, headers: { 'User-Agent': 'revision-1/1.0 (+plateforme de classe)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return parseFeed(await res.text(), feed);
  } finally {
    clearTimeout(t);
  }
}

async function getNews(force = false) {
  if (!force && Date.now() - cache.at < CACHE_MS && cache.items.length) return cache;
  const feeds = JSON.parse(fs.readFileSync(FEEDS_FILE, 'utf8'));
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const items = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push(feeds[i].name);
  });
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  cache = { at: Date.now(), items: items.slice(0, 150), errors };
  return cache;
}

module.exports = { getNews, parseFeed };
