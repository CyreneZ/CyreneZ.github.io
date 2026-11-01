// Cyrene's profile. Everything on the page is rendered from profile.json and posts.json.

const $ = (selector, root = document) => root.querySelector(selector);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

const pad = (n) => String(Math.floor(n)).padStart(2, '0');
const clock = (seconds) => `${pad(seconds / 60)}:${pad(seconds % 60)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData;

let toastTimer;
function toast(message) {
  const node = $('#toast');
  const dialog = $('#viewer');
  (dialog.open ? dialog : document.body).append(node); // an open dialog covers everything outside it
  node.textContent = message;
  node.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('on'), 1800);
}

/* ── muted preview clips ──────────────────────────────────────── */

function startClip(video) {
  if (calm) return;
  if (!video.src) video.src = video.dataset.src;
  video.play().catch(() => {}); // low power mode: the still image stays
}

const inViewClips = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (isIntersecting) startClip(target);
    else target.pause();
  }
}, { threshold: .3 });

// wall clips only play while they cross the middle of the screen, the page's own playhead
const centreClips = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    target.dataset.centre = isIntersecting ? '1' : '';
    if (isIntersecting) startClip(target);
    else if (!target.parentElement.matches(':hover')) target.pause();
  }
}, { rootMargin: '-40% 0px -40% 0px' });

const seen = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue;
    target.classList.add('seen');
    seen.unobserve(target);
  }
}, { rootMargin: '0px 0px -6% 0px' });

// Pausing or moving a clip does not fire the observers again, so they are asked to look again.
const clipWatchers = [];

function watchClip(video, observer) {
  observer.observe(video);
  clipWatchers.push(() => {
    observer.unobserve(video);
    observer.observe(video);
  });
}

const rewatchClips = () => clipWatchers.forEach((rewatch) => rewatch());

function mediaButton(post, className, onOpen, loading = 'lazy') {
  const isEdit = post.type === 'edit';
  const button = el('button', {
    class: className,
    type: 'button',
    'aria-label': `${isEdit ? 'watch' : 'view'} ${post.title || (isEdit ? 'edit' : 'photo')}`,
    onclick: () => onOpen(post),
  }, el('img', { src: post.thumb, alt: '', loading, decoding: 'async', onerror: ({ target }) => target.remove() }));

  if (post.preview) {
    const video = el('video', { class: 'clip', muted: '', playsinline: '', loop: '', preload: 'none', 'aria-hidden': 'true', 'data-src': post.preview });
    video.muted = true;
    video.addEventListener('playing', () => video.classList.add('on'));
    button.append(video);
  }

  if (post.title || post.duration) {
    button.append(el('span', { class: 'cap' },
      el('b', { text: post.title || '' }),
      post.duration ? el('time', { text: clock(post.duration) }) : ''));
  }
  return button;
}

/* ── hero ─────────────────────────────────────────────────────── */

const WAVE = [.52, .8, 1, .68, .44, .62, .92, .58, .4];

function renderWave(pool, onOpen) {
  if (!pool.length) return; // the empty bars in the HTML stay
  const bars = WAVE.map((height, i) => {
    const post = pool[i % pool.length];
    const bar = mediaButton(post, 'bar', onOpen, 'eager');
    bar.style.setProperty('--h', height);
    bar.style.setProperty('--i', i);
    // only a few posts so far: show a different slice of each one every time it repeats
    if (pool.length < WAVE.length) bar.style.setProperty('--x', `${(i * 37 + 18) % 100}%`);
    return bar;
  });
  $('#wave').replaceChildren(...bars);
  bars.forEach((bar) => { const clip = $('video', bar); if (clip) watchClip(clip, inViewClips); });
}

function renderDiscord(discord, avatar, name) {
  if (!discord?.id && !discord?.username) return;
  const box = $('#discord');
  const dot = el('i', { hidden: '' });
  const status = el('span', { text: discord.username ? `@${discord.username}` : 'say hi ♡' });
  const pic = el('span', { class: 'dc__pic' }, el('img', { src: avatar, alt: '' }), dot);
  const text = el('span', { class: 'dc__txt' }, el('b', { text: `${name} on discord` }), status);
  const link = el(discord.id ? 'a' : 'span', {
    class: 'dc__link',
    href: discord.id ? `https://discord.com/users/${discord.id}` : undefined,
    target: discord.id ? '_blank' : undefined,
    rel: 'noopener',
  }, pic, text);

  box.append(link);
  if (discord.username) {
    const copy = el('button', {
      class: 'dc__copy',
      type: 'button',
      'aria-label': 'copy discord username',
      onclick: () => navigator.clipboard.writeText(discord.username).then(() => toast('copied ♡'), () => toast(`@${discord.username}`)),
    });
    copy.innerHTML = '<svg><use href="#i-copy"/></svg>';
    box.append(copy);
  }
  box.hidden = false;
  if (discord.live && discord.id) presence(discord.id, dot, status, discord.username);
}

// live status through lanyard.rest, which only knows people who joined its discord server
async function presence(id, dot, status, username) {
  const words = { online: 'online now', idle: 'away for a bit', dnd: 'do not disturb', offline: 'offline' };
  try {
    const reply = await fetch(`https://api.lanyard.rest/v1/users/${id}`);
    if (!reply.ok) return;
    const { data } = await reply.json();
    const custom = data.activities?.find((activity) => activity.type === 4)?.state;
    dot.hidden = false;
    dot.dataset.status = data.discord_status;
    status.textContent = data.spotify ? `♫ ${data.spotify.song}` : custom || words[data.discord_status] || (username ? `@${username}` : '');
    setTimeout(() => presence(id, dot, status, username), 30000);
  } catch { /* status is a bonus, the card works without it */ }
}

/* ── walls ────────────────────────────────────────────────────── */

function renderWall(wall, tiles, columnsFor) {
  let shown = 0;
  const lay = () => {
    const count = columnsFor(innerWidth);
    if (count === shown) return;
    shown = count;
    const columns = Array.from({ length: count }, () => el('div', { class: 'wall__col' }));
    const heights = columns.map(() => 0);
    for (const { node, ratio } of tiles) {
      const shortest = heights.indexOf(Math.min(...heights));
      columns[shortest].append(node);
      heights[shortest] += ratio;
    }
    wall.replaceChildren(...columns);
    rewatchClips();
  };
  lay();
  addEventListener('resize', lay, { passive: true });
}

function makeTile(post, onOpen) {
  const node = mediaButton(post, 'tile', onOpen);
  node.style.aspectRatio = `${post.w} / ${post.h}`;
  seen.observe(node);
  const clip = $('video', node);
  if (clip) {
    watchClip(clip, centreClips);
    node.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') startClip(clip); });
    node.addEventListener('pointerleave', () => { if (!clip.dataset.centre) clip.pause(); });
  }
  return { node, ratio: post.h / post.w };
}

/* ── viewer ───────────────────────────────────────────────────── */

const viewer = $('#viewer');
const stage = $('#vStage');
const player = $('#vVideo');
const picture = $('#vImg');
const range = $('#vRange');
const time = $('#vTime');
const muteUse = $('#vMute use');

let queue = [];
let at = 0;
let muted = false;

function setMuted(value) {
  muted = value;
  player.muted = value;
  muteUse.setAttribute('href', value ? '#i-mute' : '#i-sound');
  $('#vMute').setAttribute('aria-label', value ? 'unmute' : 'mute');
}

function clearPlayer() {
  player.pause();
  player.removeAttribute('src');
  player.load();
}

function showCurrent() {
  const post = queue[at];
  const isEdit = post.type === 'edit';
  viewer.classList.toggle('is-video', isEdit);
  stage.style.setProperty('--ar', post.w / post.h);
  $('#vBg').style.backgroundImage = `url("${post.thumb}")`;
  $('#vTitle').textContent = post.title || '';
  $('#vCount').textContent = queue.length > 1 ? `${at + 1} / ${queue.length}` : '';
  range.value = 0;
  range.style.setProperty('--p', '0%');
  time.textContent = post.duration ? clock(post.duration) : '';

  if (isEdit) {
    picture.removeAttribute('src');
    player.poster = post.thumb;
    player.src = post.src;
    player.muted = muted;
    player.play().catch((error) => {
      if (error.name !== 'NotAllowedError') return; // arrived through a shared link: browsers want a tap before sound
      setMuted(true);
      player.play().catch(() => {});
      toast('tap the speaker for sound ♡');
    });
  } else {
    clearPlayer();
    picture.src = post.src;
    picture.alt = post.title || 'photo';
  }

  const upcoming = queue[(at + 1) % queue.length];
  if (upcoming) new Image().src = upcoming.thumb;
}

function step(direction) {
  if (queue.length < 2) return;
  at = (at + direction + queue.length) % queue.length;
  history.replaceState({ viewer: true }, '', `#/${queue[at].id}`);
  showCurrent();
}

function closeViewer() {
  clearPlayer();
  viewer.close();
  rewatchClips();
}

const leaveViewer = () => (history.state?.viewer ? history.back() : closeViewer());

function togglePlay() {
  if (!viewer.classList.contains('is-video')) return;
  if (player.paused) player.play().catch(() => {});
  else player.pause();
}

function trackProgress() {
  if (!viewer.open) return;
  if (player.duration && !player.paused) {
    const part = player.currentTime / player.duration;
    range.value = part * 1000;
    range.style.setProperty('--p', `${part * 100}%`);
    time.textContent = clock(player.currentTime);
  }
  requestAnimationFrame(trackProgress);
}

function bindViewer() {
  $('#vClose').addEventListener('click', leaveViewer);
  $('#vPrev').addEventListener('click', () => step(-1));
  $('#vNext').addEventListener('click', () => step(1));
  $('#vMute').addEventListener('click', () => setMuted(!muted));
  $('#vShare').addEventListener('click', () => {
    navigator.clipboard.writeText(location.href).then(() => toast('link copied ♡'), () => toast("couldn't copy the link"));
  });
  $('#vBg').addEventListener('click', leaveViewer);
  player.addEventListener('click', togglePlay);
  player.addEventListener('error', () => { if (player.getAttribute('src')) toast("this one won't play right now"); });
  picture.addEventListener('error', () => { if (picture.getAttribute('src')) toast("this one won't load right now"); });

  range.addEventListener('input', () => {
    if (!player.duration) return;
    player.currentTime = range.value / 1000 * player.duration;
    range.style.setProperty('--p', `${range.value / 10}%`);
    time.textContent = clock(player.currentTime);
  });

  viewer.addEventListener('cancel', (event) => { event.preventDefault(); leaveViewer(); });

  viewer.addEventListener('keydown', (event) => {
    const onControl = event.target.closest('button, input');
    const keys = {
      ArrowDown: () => step(1),
      ArrowUp: () => step(-1),
      ArrowRight: () => step(1),
      ArrowLeft: () => step(-1),
      ' ': togglePlay,
      m: () => setMuted(!muted),
    };
    if (!keys[event.key] || (onControl && (event.key === ' ' || event.target === range))) return;
    event.preventDefault();
    keys[event.key]();
  });

  let touchY = null;
  stage.addEventListener('touchstart', (event) => {
    touchY = event.target === range ? null : event.touches[0].clientY;
  }, { passive: true });
  stage.addEventListener('touchmove', (event) => {
    if (event.target !== range) event.preventDefault(); // left alone, a flick turns into a fling that swallows the next tap
  }, { passive: false });
  stage.addEventListener('touchend', (event) => {
    if (touchY === null) return;
    const distance = event.changedTouches[0].clientY - touchY;
    if (Math.abs(distance) > 56) step(distance < 0 ? 1 : -1);
  });

  let wheelAt = 0;
  viewer.addEventListener('wheel', (event) => {
    const now = Date.now();
    if (now - wheelAt < 550 || Math.abs(event.deltaY) < 24) return;
    wheelAt = now;
    step(event.deltaY > 0 ? 1 : -1);
  }, { passive: true });
}

/* ── timeline ─────────────────────────────────────────────────── */

function renderTimeline(sections, totalSeconds) {
  $('#timeline').hidden = false;
  const track = $('#track');
  const head = $('.tl__head', track);
  const bow = $('.bow', head);
  const code = $('#timecode');
  const clips = sections.map((section) => {
    const clip = el('a', { class: 'tl__clip', href: `#${section.id}`, text: section.dataset.label || section.id });
    clip.addEventListener('click', (event) => {
      event.preventDefault();
      section.scrollIntoView();
    });
    return clip;
  });
  track.prepend(...clips);

  let tops = [];
  let queued = false;
  let current = -1;

  function draw() {
    queued = false;
    const page = document.documentElement.scrollHeight;
    const scrollable = page - innerHeight;
    const progress = scrollable > 0 ? Math.min(scrollY / scrollable, 1) : 0;
    const y = scrollY + innerHeight * progress; // slides from the top of the screen to the bottom, so the last section is reached
    let index = 0;
    while (index < sections.length - 1 && tops[index + 1] <= y) index += 1;
    const inside = (y - tops[index]) / ((tops[index + 1] ?? page) - tops[index]);
    head.style.transform = `translateX(${(index + Math.min(inside, 1)) / sections.length * track.clientWidth}px)`;
    if (index !== current) {
      clips.forEach((clip, i) => clip.setAttribute('aria-current', i === index ? 'true' : 'false'));
      if (current >= 0 && !calm) bow.animate([{ rotate: '0deg' }, { rotate: '-16deg' }, { rotate: '12deg' }, { rotate: '0deg' }], { duration: 520, easing: 'ease-out' });
      current = index;
    }
    const elapsed = progress * totalSeconds;
    code.textContent = `${pad(elapsed / 60)}:${pad(elapsed % 60)}:${pad((elapsed % 1) * 30)}`;
  }

  const measure = () => {
    tops = sections.map((section) => section.offsetTop);
    draw();
  };

  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  }, { passive: true });
  new ResizeObserver(measure).observe(document.body);
  measure();
}

/* ── start ────────────────────────────────────────────────────── */

async function readJson(file) {
  const reply = await fetch(file);
  if (!reply.ok) throw new Error(`${file}: ${reply.status}`);
  return reply.json();
}

function renderProfile(profile) {
  $('#name').textContent = profile.name;
  $('#role').textContent = profile.role;
  $('#tagline').textContent = profile.tagline;
  $('#aboutText').textContent = profile.about;
  $('#sign').textContent = `with love, ${profile.name}`;
  $('#aboutPic').append(el('img', { src: profile.portrait, alt: profile.name, loading: 'lazy' }));
  $('#links').append(...(profile.links || []).map(({ label, url }) => el('li', {},
    el('a', { href: url, target: '_blank', rel: 'noopener', text: `${label} ↗` }))));
  renderDiscord(profile.discord, profile.avatar, profile.name);
}

function renderPosts(posts) {
  const edits = posts.filter((post) => post.type === 'edit');
  const photos = posts.filter((post) => post.type === 'photo');

  const open = (post, { push = true } = {}) => {
    queue = post.type === 'edit' ? edits : photos;
    at = queue.indexOf(post);
    if (push) history.pushState({ viewer: true }, '', `#/${post.id}`);
    if (!viewer.open) {
      document.querySelectorAll('video.clip').forEach((clip) => clip.pause());
      viewer.showModal();
      stage.focus();
      requestAnimationFrame(trackProgress);
    }
    showCurrent();
  };

  renderWave([...edits, ...photos], open);

  const totalSeconds = edits.reduce((sum, post) => sum + (post.duration || 0), 0);
  $('#editsMeta').textContent = edits.length ? `${plural(edits.length, 'clip')} · ${clock(totalSeconds)}` : '';
  $('#photosMeta').textContent = photos.length ? plural(photos.length, 'photo') : '';

  if (edits.length) renderWall($('#editsWall'), edits.map((post) => makeTile(post, open)), (width) => (width < 640 ? 2 : width < 1100 ? 3 : 4));
  else $('#editsWall').append(el('p', { class: 'wall__empty', text: 'first edit coming soon ♡' }));
  if (photos.length) renderWall($('#photosWall'), photos.map((post) => makeTile(post, open)), (width) => (width < 640 ? 2 : 3));
  else $('#photos').hidden = true;

  const fromHash = () => posts.find((post) => `#/${post.id}` === location.hash);
  addEventListener('popstate', () => {
    const post = fromHash();
    if (post) open(post, { push: false });
    else if (viewer.open) closeViewer();
  });

  const linked = fromHash();
  if (linked) {
    history.replaceState(null, '', location.pathname);
    open(linked);
  }

  const sections = ['intro', 'edits', 'photos', 'about'].map((id) => $(`#${id}`)).filter((section) => !section.hidden);
  renderTimeline(sections, totalSeconds);
}

// the name only wipes in once its font is here, so it never swaps mid-animation
function revealName() {
  const ready = () => document.documentElement.classList.add('fonts-ready');
  document.fonts.load('italic 300 100px "Noto Serif Display"', 'Cyrene').then(ready, ready);
  setTimeout(ready, 1200);
}

async function start() {
  revealName();
  bindViewer();
  document.querySelectorAll('.sec__title').forEach((title) => seen.observe(title));
  try {
    const [profile, posts] = await Promise.all([readJson('profile.json'), readJson('posts.json')]);
    renderProfile(profile);
    renderPosts(posts);
  } catch (error) {
    console.error(error);
    ['edits', 'photos', 'about'].forEach((id) => { $(`#${id}`).hidden = true; });
    $('#wave').replaceChildren(el('p', { class: 'wall__empty' },
      "couldn't load this page. ",
      el('button', { class: 'wall__retry', type: 'button', text: 'try again', onclick: () => location.reload() })));
  }
}

start();
