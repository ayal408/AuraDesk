const root = document.querySelector('#wallpaper-root');
let kind = 'builtin';
let source = 'aurora';
let media = null;
let animationFrame = null;

function addStars(container, count = 90) {
  for (let index = 0; index < count; index += 1) {
    const star = document.createElement('i');
    star.className = 'star';
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    const size = 1 + Math.random() * 2.2;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.opacity = String(.25 + Math.random() * .7);
    star.style.setProperty('--speed', `${1.4 + Math.random() * 4}s`);
    container.append(star);
  }
}

function renderAurora() {
  const scene = document.createElement('div');
  scene.className = 'aurora-scene';
  for (const name of ['one', 'two', 'three']) {
    const ribbon = document.createElement('div');
    ribbon.className = `aurora-ribbon ${name}`;
    scene.append(ribbon);
  }
  addStars(scene, 75);
  root.append(scene);
}

function renderNebula() {
  const scene = document.createElement('div');
  scene.className = 'nebula-scene';
  const canvas = document.createElement('canvas');
  scene.append(canvas);
  root.append(scene);
  const context = canvas.getContext('2d');
  const particles = Array.from({ length: 180 }, () => ({
    x: Math.random(), y: Math.random(), z: Math.random(), speed: .00008 + Math.random() * .00018
  }));

  function resize() {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
  }
  addEventListener('resize', resize);
  resize();

  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const particle of particles) {
      particle.z += particle.speed;
      if (particle.z > 1) particle.z = 0;
      const scale = .18 + particle.z * .95;
      const x = (particle.x - .5) * scale * canvas.width + canvas.width / 2;
      const y = (particle.y - .5) * scale * canvas.height + canvas.height / 2;
      const radius = (.4 + particle.z * 1.8) * devicePixelRatio;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(${150 + particle.z * 100},${175 + particle.z * 70},255,${.18 + particle.z * .8})`;
      context.fill();
    }
    animationFrame = requestAnimationFrame(draw);
  }
  draw();
}

function renderGrid() {
  const scene = document.createElement('div');
  scene.className = 'grid-scene';
  for (const className of ['grid-sun', 'grid-mountains', 'grid-glow', 'grid-floor']) {
    const element = document.createElement('div');
    element.className = className;
    scene.append(element);
  }
  root.append(scene);
}

function renderMedia(tagName) {
  media = document.createElement(tagName);
  media.className = 'media';
  media.src = source;
  if (tagName === 'video') {
    media.loop = true;
    media.autoplay = true;
    media.playsInline = true;
  }
  root.append(media);
}

function initialize(config) {
  kind = config?.kind || 'builtin';
  source = config?.source || 'aurora';
  root.replaceChildren();
  if (kind === 'video') renderMedia('video');
  else if (kind === 'image') renderMedia('img');
  else if (source === 'nebula') renderNebula();
  else if (source === 'grid') renderGrid();
  else renderAurora();
}

window.wallpaperHost?.onConfig(initialize);

window.wallpaperHost?.onPlayback((command) => {
  const paused = command === 'pause';
  document.documentElement.classList.toggle('paused', paused);
  if (media?.tagName === 'VIDEO') {
    if (paused) media.pause();
    else media.play().catch(() => {});
  }
  if (kind === 'builtin' && source === 'nebula') {
    if (paused && animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    } else if (!paused && !animationFrame) {
      initialize({ kind, source });
    }
  }
});
