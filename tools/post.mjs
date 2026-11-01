// Posts photos and videos to the site.
//   node tools/post.mjs <files...>     compress them, add them to posts.json, then ask to publish
//   node tools/post.mjs --delete       pick a post to remove
//   node tools/post.mjs --sync         publish hand edits to profile.json or posts.json
// Flags: --no-publish skips the publish question, --sample marks posts as placeholders.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS = path.join(ROOT, 'posts.json');
const PROFILE = path.join(ROOT, 'profile.json');
const INDEX = path.join(ROOT, 'index.html');
const SITE_URL = 'https://cyrenez.github.io/';

const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.gif']);
const PHOTO = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff']);

const MB = 1024 * 1024;
const GITHUB_FILE_LIMIT = 100 * MB; // git push is refused above this
const PAGES_SITE_LIMIT = 1024 * MB; // GitHub Pages' size limit for a whole site
const LONG_EDGE_PHOTO = 2200;

const NO_META = ['-map_metadata', '-1', '-map_chapters', '-1']; // keeps GPS and device info off the public site

const size = (file) => fs.statSync(file).size;
const mb = (bytes) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

function slugify(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

// "IMG_1234", "VID_20261101_1230" and CapCut's "0602(1)" are not real titles
function titleFrom(file) {
  const name = path.parse(file).name.replace(/[_-]+/g, ' ').trim();
  return /^(img|vid|video|mov|dsc|pxl|mvimg|capcut|screenshot|screen recording|snapchat|photo)?[\s\d().,]*$/i.test(name) ? '' : name;
}

function ffmpegSync(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim().split('\n').slice(-3).join('\n'));
}

function probe(file) {
  const { stderr } = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const stream = /Stream .*Video: .*?[, ](\d{2,5})x(\d{2,5})/.exec(stderr);
  if (!stream) throw new Error('không đọc được file này');
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  const rotation = /rotation of (-?[\d.]+) degrees/.exec(stderr);
  const turned = rotation && Math.abs(+rotation[1]) % 180 === 90;
  return {
    w: turned ? +stream[2] : +stream[1],
    h: turned ? +stream[1] : +stream[2],
    duration: duration ? +duration[1] * 3600 + +duration[2] * 60 + +duration[3] : 0,
    hasAudio: /Stream .*Audio:/.test(stderr),
  };
}

function encodeVideo(args, duration, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...args]);
    let errors = '';
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.stdout.on('data', (chunk) => {
      const done = /out_time_us=(\d+)/.exec(String(chunk));
      if (done && duration) process.stdout.write(`\r    ${label} ${Math.min(99, Math.round(done[1] / 1e6 / duration * 100))}%   `);
    });
    child.on('close', (code) => {
      process.stdout.write('\r' + ' '.repeat(40) + '\r');
      if (code === 0) resolve();
      else reject(new Error(errors.trim().split('\n').slice(-3).join('\n')));
    });
  });
}

async function postVideo(source, id) {
  const dir = path.join(ROOT, 'media', 'edits');
  fs.mkdirSync(dir, { recursive: true });
  const info = probe(source);
  const out = path.join(dir, `${id}.mp4`);
  const thumb = path.join(dir, `${id}.webp`);
  const preview = path.join(dir, `${id}.preview.mp4`);

  // shortest side at most 1080px, H.264 so every browser and phone can play it
  const scale = "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)':flags=lanczos,format=yuv420p";
  const encode = (crf, rate) => encodeVideo([
    '-i', source, ...NO_META, '-vf', scale, '-fpsmax', '60',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-maxrate', rate, '-bufsize', rate.replace(/\d+/, (n) => n * 2),
    ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-movflags', '+faststart', out,
  ], info.duration, 'nén video');

  await encode(23, '5000k');
  if (size(out) > GITHUB_FILE_LIMIT * .9) await encode(30, '2000k'); // long videos get a stronger pass to fit GitHub's limit
  if (size(out) > GITHUB_FILE_LIMIT * .98) {
    fs.rmSync(out);
    throw new Error(`video quá dài, sau khi nén vẫn trên 100 MB (giới hạn của GitHub). Hãy cắt ngắn lại rồi thử lại.`);
  }

  const { w, h, duration } = probe(out);
  const small = w > h ? 'scale=-2:360' : 'scale=360:-2';
  ffmpegSync(['-ss', String(duration * .12), '-i', out, ...NO_META, '-frames:v', '1', '-vf', `thumbnail=48,${w > h ? 'scale=-2:540' : 'scale=540:-2'}`, '-c:v', 'libwebp', '-quality', '78', thumb]);
  const clip = Math.min(3.2, duration);
  ffmpegSync(['-ss', String(Math.max(0, Math.min(duration * .3, duration - clip))), '-t', String(clip), '-i', out, ...NO_META, '-an',
    '-vf', `${small},fps=24`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '31', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', preview]);

  console.log(`    ${mb(size(source))} → ${mb(size(out))}`);
  return { type: 'edit', src: relative(out), thumb: relative(thumb), preview: relative(preview), w, h, duration: +duration.toFixed(2) };
}

function postPhoto(source, id) {
  const dir = path.join(ROOT, 'media', 'photos');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${id}.webp`);
  const thumb = path.join(dir, `${id}.thumb.webp`);
  const fit = (limit) => `scale='if(gt(iw,ih),min(${limit},iw),-2)':'if(gt(iw,ih),-2,min(${limit},ih))':flags=lanczos`;

  ffmpegSync(['-i', source, ...NO_META, '-frames:v', '1', '-vf', fit(LONG_EDGE_PHOTO), '-c:v', 'libwebp', '-quality', '84', out]);
  ffmpegSync(['-i', source, ...NO_META, '-frames:v', '1', '-vf', fit(760), '-c:v', 'libwebp', '-quality', '76', thumb]);

  const { w, h } = probe(out);
  console.log(`    ${mb(size(source))} → ${mb(size(out))}`);
  return { type: 'photo', src: relative(out), thumb: relative(thumb), w, h };
}

function postFiles(post) {
  return [post.src, post.thumb, post.preview].filter(Boolean).map((file) => path.join(ROOT, file));
}

function removePost(post) {
  for (const file of postFiles(post)) fs.rmSync(file, { force: true });
}

function usage() {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const file = path.join(dir, entry.name);
    return sum + (entry.isDirectory() ? walk(file) : size(file));
  }, 0);
  const used = walk(path.join(ROOT, 'media'));
  console.log(`\n  media đang dùng ${mb(used)} / 1024 MB (${Math.round(used / PAGES_SITE_LIMIT * 100)}%)`);
  if (used > PAGES_SITE_LIMIT * .85) console.log('  sắp đầy: nên xoá bớt video cũ, GitHub Pages giới hạn 1 GB cho cả trang.');
}

/* ── link preview shown by Discord ────────────────────────────── */

function syncMeta() {
  const profile = readJson(PROFILE);
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const title = escape(`${profile.name} ♡`);
  const description = escape(profile.tagline);
  const block = `<!-- meta:start (tools/post.mjs rewrites this block from profile.json) -->
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#B70F2D">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="${new URL(SITE_URL).host}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${SITE_URL}">
<meta property="og:image" content="${SITE_URL}media/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<!-- meta:end -->`;
  const html = fs.readFileSync(INDEX, 'utf8');
  fs.writeFileSync(INDEX, html.replace(/<!-- meta:start[\s\S]*?<!-- meta:end -->/, () => block));
}

function findEdge() {
  const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  return bases.map((base) => path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((file) => fs.existsSync(file));
}

// Draws the 1200×630 card Discord shows under the link, newest edits first.
function buildCard(posts) {
  const edge = findEdge();
  if (!edge) return console.log('  không tìm thấy Edge nên giữ nguyên ảnh xem trước cũ.');
  const profile = readJson(PROFILE);
  const pool = [...posts.filter((post) => post.type === 'edit'), ...posts.filter((post) => post.type === 'photo')];
  const heights = [.62, .86, 1, .74, .54];
  const bars = !pool.length ? '' : heights.map((height, i) => {
    const across = pool.length < heights.length ? (i * 37 + 18) % 100 : 50; // few posts: a different slice each time one repeats
    return `<i style="height:${height * 100}%;background-image:url('${pool[i % pool.length].thumb}');background-position:${across}% 28%"></i>`;
  }).join('');
  const page = path.join(ROOT, '.og-card.html');
  const shot = path.join(ROOT, '.og-card.png');
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400&family=Noto+Serif+Display:ital,wght@1,300&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden}
  body{background:#FFF8F3;color:#B70F2D;display:grid;grid-template-columns:600px 1fr;align-items:center;padding:0 56px;box-sizing:border-box;gap:36px}
  h1{margin:0;font:italic 300 208px/1 'Noto Serif Display',serif;letter-spacing:-.045em}
  p{margin:36px 0 0 6px;font:400 26px/1.4 'Be Vietnam Pro',sans-serif;color:#2A0B12}
  div.w{display:flex;align-items:center;gap:12px;height:510px}
  i{flex:1;border-radius:999px;background-color:#FBE5E3;background-size:cover}
</style>
<div><h1>${profile.name}</h1><p>${profile.tagline}</p></div><div class="w">${bars}</div>`);
  spawnSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${path.join(ROOT, 'node_modules', '.edge')}`,
    '--virtual-time-budget=5000', '--window-size=1200,630', `--screenshot=${shot}`, pathToFileURL(page).href], { stdio: 'ignore', timeout: 60000 });
  if (fs.existsSync(shot)) ffmpegSync(['-i', shot, '-q:v', '3', path.join(ROOT, 'media', 'og.jpg')]);
  fs.rmSync(page, { force: true });
  fs.rmSync(shot, { force: true });
}

/* ── publishing ───────────────────────────────────────────────── */

function git(...args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: result.status === 0, out: `${result.stdout}${result.stderr}`.trim() };
}

async function ask(question) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(question);
  prompt.close();
  return answer;
}

async function publish(message) {
  const answer = await ask('\n  Đăng lên web luôn? [Y/n] ');
  if (/^n/i.test(answer.trim())) return console.log('  Đã lưu trong máy, chưa đăng.');
  git('add', '-A', '--', 'media', 'posts.json', 'profile.json', 'index.html');
  const commit = git('commit', '-m', message);
  if (!commit.ok && !/nothing to commit/.test(commit.out)) return console.log(`  Không commit được:\n${commit.out}`);
  console.log('  Đang đẩy lên GitHub...');
  const push = git('push', 'origin', 'main');
  if (!push.ok) return console.log(`  Chưa đẩy được lên GitHub:\n${push.out}\n  Bài vẫn được lưu, thử chạy lại sau.`);
  console.log(`  Xong ♡ vài phút nữa sẽ hiện ở ${SITE_URL}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const files = argv.filter((arg) => !arg.startsWith('--'));
  let posts = readJson(POSTS);

  if (flags.has('--sync')) {
    syncMeta();
    buildCard(posts);
    return publish('update profile');
  }

  if (flags.has('--delete')) {
    if (!posts.length) return console.log('  Chưa có bài nào.');
    posts.forEach((post, i) => console.log(`  ${String(i + 1).padStart(3)}. ${post.type === 'edit' ? 'edit ' : 'photo'}  ${post.date}  ${post.title || post.id}`));
    const picks = (await ask('\n  Số bài muốn xoá (vd: 2 hoặc 2,5, Enter để thôi): ')).split(/[\s,]+/).filter(Boolean).map(Number);
    const chosen = picks.map((n) => posts[n - 1]).filter(Boolean);
    if (!chosen.length) return console.log('  Không xoá gì cả.');
    chosen.forEach(removePost);
    posts = posts.filter((post) => !chosen.includes(post));
    fs.writeFileSync(POSTS, `${JSON.stringify(posts, null, 2)}\n`);
    buildCard(posts);
    usage();
    return publish(`remove: ${chosen.map((post) => post.title || post.id).join(', ')}`);
  }

  if (!files.length) return console.log('\n  Kéo file ảnh hoặc video rồi thả vào biểu tượng dang-bai.bat nhé ♡\n');

  const added = [];
  const taken = new Set(posts.map((post) => post.id));
  for (const file of files) {
    const source = path.resolve(file);
    const extension = path.extname(source).toLowerCase();
    const title = titleFrom(source);
    console.log(`\n  ${path.basename(source)}`);
    try {
      if (!fs.existsSync(source)) throw new Error('không tìm thấy file');
      if (!VIDEO.has(extension) && !PHOTO.has(extension)) {
        throw new Error(extension === '.heic' ? 'chưa đọc được HEIC, hãy đổi sang JPG rồi thử lại' : `chưa hỗ trợ định dạng ${extension || 'này'}`);
      }
      const base = slugify(title) || `post-${Date.now().toString(36)}`;
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      const media = VIDEO.has(extension) ? await postVideo(source, id) : postPhoto(source, id);
      added.push({ id, title, date: new Date().toLocaleDateString('en-CA'), ...media, ...(flags.has('--sample') ? { sample: true } : {}) });
    } catch (error) {
      console.log(`    bỏ qua: ${error.message}`);
    }
  }

  if (!added.length) return console.log('\n  Không có bài nào được thêm.');

  if (!flags.has('--sample') && posts.some((post) => post.sample)) {
    posts.filter((post) => post.sample).forEach(removePost);
    posts = posts.filter((post) => !post.sample);
    console.log('\n  Đã xoá các bài mẫu.');
  }

  posts = [...added.reverse(), ...posts];
  fs.writeFileSync(POSTS, `${JSON.stringify(posts, null, 2)}\n`);
  console.log(`\n  Đã thêm ${added.length} bài.`);
  usage();
  if (flags.has('--no-publish') || flags.has('--sample')) return;
  syncMeta();
  buildCard(posts);
  await publish(`post: ${added.map((post) => post.title || post.id).join(', ')}`);
}

main().catch((error) => {
  console.error(`\n  Có lỗi: ${error.message}`);
  process.exitCode = 1;
});
