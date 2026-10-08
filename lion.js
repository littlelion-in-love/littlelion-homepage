/* littlelion: a local, articulated 2D cutout rig.
 * Original artwork supplies every textured surface. The two source images are
 * never exchanged as frames: a planted body and tail, head, two-bone foreleg and
 * turning paw are drawn independently, with continuous spring-driven joints.
 * No libraries, network calls, storage, telemetry or audio.
 */
(() => {
  'use strict';
  const button = document.querySelector('.lion-button');
  const art = button?.querySelector('.lion-art');
  const message = document.querySelector('#lion-message');
  const hint = document.querySelector('#lion-hint');
  if (!button || !art || !message || !hint) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const idleURL = art.querySelector('.lion-idle')?.getAttribute('src') || './assets/lion-idle.png';
  const palmURL = art.querySelector('.lion-high-five')?.getAttribute('src') || './assets/lion-high-five.png';
  const initialHint = hint.textContent;
  const replies = ['High five!', 'Nice to meet you!', 'Thanks for stopping by!', 'Hello again!', 'One more?'];
  let reply = 0;
  let ready = false;
  let raf = 0;
  let previous = 0;
  let holdUntil = 0;
  let feedbackTimer = 0;
  let inView = true;
  let pointerX = 0;
  let pointerY = 0;
  let trackingX = 0;
  let trackingY = 0;
  let lift = 0;
  let liftVelocity = 0;
  let tap = 0;
  let clock = 0;
  let ctx;
  let body;
  let head;
  let upper;
  let pawBack;
  let pawFront;
  let canvas;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = (lo, hi, v) => {
    const t = clamp((v - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const path = (d) => new Path2D(d);
  const headShape = path('M120 80H855V565L737 569Q701 614 654 633Q639 654 591 651Q565 664 536 651Q507 674 470 682Q445 666 415 656Q377 659 349 636Q302 623 275 603L179 546Z');
  const armShape = path('M349 627Q368 623 386 641Q404 692 428 742Q445 784 449 822Q469 838 466 865Q465 887 443 893Q396 904 345 894Q320 888 318 863Q314 833 339 817Q325 779 325 735Q320 683 340 649Z');
  const backShape = path('M339 815Q379 807 419 818Q447 813 462 837Q475 865 457 885Q442 900 401 898L346 895Q322 890 319 869Q311 838 339 815Z');
  const palmShape = path('M166 517Q168 495 188 486Q179 464 205 457Q222 455 236 469Q244 447 262 451Q283 450 294 483Q315 481 329 499Q343 517 333 547Q318 582 282 603Q250 621 222 602Q199 592 181 568Q157 540 166 517Z');

  function surface(w = 1024, h = 1024) {
    const el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    return el;
  }
  function extract(image, shape) {
    const layer = surface();
    const c = layer.getContext('2d');
    c.clip(shape);
    c.drawImage(image, 0, 0);
    return layer;
  }
  function load(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }

  function createLayers(idle, greeting) {
    head = extract(idle, headShape);
    pawBack = extract(idle, backShape);
    pawFront = extract(greeting, palmShape);
    // The second illustration supplies one continuous, stationary torso and
    // hind legs. A cut below its mane and inside its raised arm removes both;
    // it never changes pose or crossfades. The idle texture supplies the head.
    body = surface();
    const b = body.getContext('2d');
    b.save();
    b.clip(path('M345 617H653L678 639L679 568H866V932H202V709H315Q339 678 345 617Z'));
    b.drawImage(greeting, 0, 0);
    b.restore();
    // Keep an overlapping lower fringe under the moving head. Its few pixels
    // of coverage prevent a cut line from opening when the lion breathes.
    b.save();
    b.clip(headShape);
    b.beginPath(); b.rect(268, 612, 410, 82); b.clip();
    b.drawImage(idle, 0, 0);
    b.restore();
    const wholeArm = extract(idle, armShape);
    upper = surface(190, 220);
    const u = upper.getContext('2d');
    // The toes belong exclusively to the articulated paw, not the forearm.
    u.clip(path('M0 0H190V195L149 220H40L40 200H0Z'));
    u.drawImage(wholeArm, 300, 615, 190, 220, 0, 0, 190, 220);
  }

  // A fine strip mesh gives the foreleg a rounded elbow rather than rotating
  // a single rigid picture. The original seated pose is an identity transform.
  function centerline(y, amount) {
    const shoulder = { x: 369, y: 650 };
    const elbow = { x: 386 - 102 * amount, y: 748 - 89 * amount };
    const wrist = { x: 396 - 149 * amount, y: 835 - 287 * amount };
    const upper = { x: (elbow.x - shoulder.x) / 98, y: (elbow.y - shoulder.y) / 98 };
    const lower = { x: (wrist.x - elbow.x) / 87, y: (wrist.y - elbow.y) / 87 };
    if (y < 724) return { x: shoulder.x + (y - 650) * upper.x, y: shoulder.y + (y - 650) * upper.y, dx: upper.x, dy: upper.y };
    if (y > 772) return { x: elbow.x + (y - 748) * lower.x, y: elbow.y + (y - 748) * lower.y, dx: lower.x, dy: lower.y };
    // A quadratic fillet meets both bones with matching first derivatives.
    // Its texture normals follow that same curve, rounding both elbow edges.
    const t = (y - 724) / 48, q = 1 - t;
    const a = { x: elbow.x - 24 * upper.x, y: elbow.y - 24 * upper.y };
    const c = { x: elbow.x + 24 * lower.x, y: elbow.y + 24 * lower.y };
    return {
      x: q * q * a.x + 2 * q * t * elbow.x + t * t * c.x,
      y: q * q * a.y + 2 * q * t * elbow.y + t * t * c.y,
      dx: q * upper.x + t * lower.x,
      dy: q * upper.y + t * lower.y
    };
  }
  function jointAt(y, amount) {
    const sourceX = 369 + (y - 650) * 27 / 185;
    const rest = centerline(y, 0);
    const posed = centerline(y, amount);
    return {
      x: sourceX + posed.x - rest.x,
      y: y + posed.y - rest.y,
      angle: Math.atan2(posed.dy, posed.dx) - Math.atan2(rest.dy, rest.dx)
    };
  }
  function deform(x, y, amount) {
    const joint = jointAt(y, amount);
    const centerX = 369 + (y - 650) * 27 / 185;
    const d = x - centerX;
    return { x: joint.x + d * Math.cos(joint.angle), y: joint.y + d * Math.sin(joint.angle) };
  }
  function triangle(source, uv, points) {
    const [a, b, c] = uv;
    const [p, q, r] = points;
    const det = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
    if (Math.abs(det) < .001) return;
    const xx = (p.x * (b.y - c.y) + q.x * (c.y - a.y) + r.x * (a.y - b.y)) / det;
    const xy = (p.y * (b.y - c.y) + q.y * (c.y - a.y) + r.y * (a.y - b.y)) / det;
    const yx = (p.x * (c.x - b.x) + q.x * (a.x - c.x) + r.x * (b.x - a.x)) / det;
    const yy = (p.y * (c.x - b.x) + q.y * (a.x - c.x) + r.y * (b.x - a.x)) / det;
    const dx = p.x - xx * a.x - yx * a.y;
    const dy = p.y - xy * a.x - yy * a.y;
    ctx.save();
    // Extend the triangle by a fraction of a source pixel to avoid seam lines.
    const cx = (p.x + q.x + r.x) / 3, cy = (p.y + q.y + r.y) / 3;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const v = points[i];
      const d = Math.hypot(v.x - cx, v.y - cy) || 1;
      const x = v.x + (v.x - cx) * .55 / d;
      const y = v.y + (v.y - cy) * .55 / d;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.clip();
    ctx.transform(xx, xy, yx, yy, dx, dy);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  }
  function drawForeleg(amount, frontOnly = false) {
    if (amount < .0002) {
      if (!frontOnly) ctx.drawImage(upper, 300, 615);
      return;
    }
    const rows = 25, cols = 4;
    for (let row = frontOnly ? 12 : 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * 190 / cols, y = row * 220 / rows;
        const uv = [{x, y}, {x:x + 190 / cols, y}, {x:x + 190 / cols, y:y + 220 / rows}, {x, y:y + 220 / rows}];
        const v = uv.map(p => deform(p.x + 300, p.y + 615, amount));
        triangle(upper, [uv[0], uv[1], uv[2]], [v[0], v[1], v[2]]);
        triangle(upper, [uv[0], uv[2], uv[3]], [v[0], v[2], v[3]]);
      }
    }
  }
  function drawPaw(amount) {
    const wrist = deform(396, 835, amount);
    const turn = smooth(.22, .79, amount);
    const roll = Math.cos(turn * Math.PI);
    const front = roll < 0;
    const width = Math.max(.025, Math.abs(roll));
    const natural = Math.atan2(87, 10);
    const lowerAngle = Math.atan2(87 - 198 * amount, 10 - 47 * amount);
    const delta = Math.atan2(Math.sin(lowerAngle - natural), Math.cos(lowerAngle - natural));
    const extension = Math.sin(amount * Math.PI) * 5;
    ctx.save();
    ctx.translate(wrist.x - tap * 5 - Math.cos(lowerAngle) * amount * 10, wrist.y - tap * 8 - extension - Math.sin(lowerAngle) * amount * 10);
    if (front) {
      // The palm artwork is oriented upward already; its base stays on wrist.
      const finalAngle = Math.atan2(-111, -37);
      ctx.rotate((lowerAngle - finalAngle) * .45 + tap * -.08);
      ctx.scale(width * (.90 + .10 * amount), .83 + .17 * amount);
      ctx.drawImage(pawFront, -258, -595);
    } else {
      ctx.rotate(delta);
      ctx.scale(width, 1 + turn * 2.2);
      ctx.drawImage(pawBack, -396, -835);
    }
    ctx.restore();
  }
  function drawSpark(x, y, size, alpha) {
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#b57839'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-size, 0); ctx.lineTo(size, 0);
    ctx.moveTo(0, -size); ctx.lineTo(0, size); ctx.stroke(); ctx.restore();
  }
  function render() {
    if (!ready) return;
    const scale = canvas.width / 1024;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, 1024, 1024);
    const a = reduce.matches ? 0 : clamp(lift, 0, 1.018);
    const breath = reduce.matches ? 0 : Math.sin(clock * 1.75) * 1.7;
    // Feet and torso retain their original pixel position throughout.
    ctx.drawImage(body, 0, 0);
    drawForeleg(a);
    ctx.save();
    ctx.translate(481 + trackingX * 5, 623 + trackingY * 3 + breath - a * 4);
    ctx.rotate(trackingX * .011 + a * .019);
    ctx.drawImage(head, -481, -623); ctx.restore();
    drawForeleg(a, true);
    drawPaw(a);
    if (a > .86 && !reduce.matches) {
      const glint = smooth(.86, 1, a) * (.45 + tap * .5);
      drawSpark(136 - tap * 7, 437 - tap * 11, 9, glint);
      drawSpark(316 + tap * 6, 433 - tap * 7, 5, glint * .75);
    }
    button.dataset.lionState = a > .82 ? 'high-five' : a > .025 ? 'moving' : 'idle';
  }
  function frame(now) {
    raf = 0;
    if (!ready || reduce.matches || document.hidden || !inView) return;
    const dt = Math.min((now - previous) / 1000 || 1 / 60, .035);
    previous = now; clock += dt;
    const target = now < holdUntil ? 1 : 0;
    // Integrate in small steps for smooth behavior on slower/mobile devices.
    const steps = Math.ceil(dt / .008);
    for (let i = 0; i < steps; i++) {
      const step = dt / steps;
      liftVelocity += (target - lift) * 85 * step - liftVelocity * 17 * step;
      lift += liftVelocity * step;
    }
    const ease = 1 - Math.exp(-dt * 5.5);
    trackingX += (pointerX - trackingX) * ease;
    trackingY += (pointerY - trackingY) * ease;
    tap *= Math.exp(-dt * 9);
    render();
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (raf || !ready || document.hidden || !inView || reduce.matches) return;
    previous = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function center() { pointerX = pointerY = 0; }
  function resize() {
    if (!ready) return;
    const size = Math.max(256, Math.min(1280, Math.round(art.getBoundingClientRect().width * Math.min(devicePixelRatio || 1, 2))));
    if (canvas.width !== size) { canvas.width = canvas.height = size; }
    render();
  }
  button.addEventListener('pointermove', event => {
    if (reduce.matches || event.pointerType === 'touch') return;
    const rect = button.getBoundingClientRect();
    pointerX = clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
    pointerY = clamp((event.clientY - rect.top) / rect.height * 2 - 1, -1, 1);
  });
  for (const name of ['pointerleave', 'pointercancel', 'lostpointercapture', 'blur']) button.addEventListener(name, center);
  button.addEventListener('click', () => {
    message.textContent = replies[reply++ % replies.length];
    hint.textContent = 'High five!';
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { hint.textContent = initialHint; }, 3000);
    if (reduce.matches || !ready) return;
    holdUntil = performance.now() + 1450;
    if (lift > .75) tap = Math.min(1, tap + .8);
    center();
    start();
  });
  document.addEventListener('visibilitychange', () => {
    center();
    if (document.hidden) stop(); else start();
  });
  reduce.addEventListener('change', () => {
    stop(); center(); trackingX = trackingY = lift = liftVelocity = tap = 0;
    holdUntil = 0; render(); start();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      if (inView) start(); else { center(); stop(); }
    }, { rootMargin: '120px' }).observe(button);
  }
  Promise.all([load(idleURL), load(palmURL)]).then(([idle, palm]) => {
    createLayers(idle, palm);
    canvas = surface();
    canvas.className = 'lion-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d', { alpha: true });
    art.append(canvas);
    ready = true;
    resize();
    art.classList.add('is-rigged');
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(art);
    else addEventListener('resize', resize);
    start();
  }).catch(() => {
    // Keep the original still image and the working, accessible text greeting.
    art.classList.add('is-still');
  });
})();
