// Tiny zero-dependency preview server: node serve.js [port] [--no-open]
// Handles range requests, which browsers need to seek inside videos.
const http = require('http'), fs = require('fs'), path = require('path'), { exec } = require('child_process');

const ROOT = __dirname;
const PORT = +process.argv[2] || 5600;
const URL = `http://localhost:${PORT}/`;
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url.endsWith('/')) url += 'index.html';
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found: ' + url); }
        const headers = {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache'
        };
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
        if (range) {
            const start = range[1] ? +range[1] : Math.max(0, stat.size - +range[2]);
            const end = range[1] && range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
            if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
            res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
            return fs.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { ...headers, 'Content-Length': stat.size });
        fs.createReadStream(file).pipe(res);
    });
}).listen(PORT, () => {
    console.log(`\n  ♡ preview running at ${URL}\n    close this window to stop\n`);
    open();
}).on('error', e => {
    if (e.code !== 'EADDRINUSE') { console.error(e.message); process.exit(1); }
    console.log(`\n  ♡ preview is already running at ${URL}\n`); // double-clicked twice: just show the page again
    open();
});

function open() {
    if (process.argv.includes('--no-open')) return;
    if (process.platform === 'win32') exec(`start "" "${URL}"`);
    else exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} "${URL}"`);
}
