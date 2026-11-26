/* ============ 拆迁小队 v2 · 两阶段玩法 ============
   阶段一【拆迁】：点击建筑砖块 → 钩子拉出 → 坍塌砖块掉进漏斗 → 变成小人弹药
   阶段二【战斗】：钩子用完后僵尸一波波进攻，小人自动投掷砖块消灭它们
================================================== */
(() => {
'use strict';

/* ---------- 常量 ---------- */
const W = 960, H = 540;
const ROAD_Y = 340;                 // 路面（建筑地基）
const BEACH_Y = 470;                // 沙滩地面（角色脚底）
const BUILD_CX = 660;
const HOOK_ANCHOR = { x: 118, y: 302 };   // 钩子锚点
const HOPPER = { x: 436, w: 88 };         // 漏斗口
const HERO_X = 170;
const GRAV = 1800;

/* ---------- DOM ---------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const hLevel = document.getElementById('hLevel');
const hEnemy = document.getElementById('hEnemy');
const hHooks = document.getElementById('hHooks');
const hBricks = document.getElementById('hBricks');
const hpFill = document.getElementById('hpFill');
const pauseBtn = document.getElementById('pauseBtn');
const skillBtn = document.getElementById('skillBtn');
const skillCount = document.getElementById('skillCount');
const overlay = document.getElementById('overlay');

/* ---------- 存档 ---------- */
const SAVE_KEY = 'chaiqian_save_v2';
function defaultSave() {
  return { bricks: 20, maxLevel: 1, upg: { dmg: 0, hp: 0, hooks: 0 }, rockets: 1 };
}
let save;
try { save = Object.assign(defaultSave(), JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); }
catch (e) { save = defaultSave(); }
save.upg = Object.assign({ dmg: 0, hp: 0, hooks: 0 }, save.upg);
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

/* ---------- 升级配置 ---------- */
const UPG = {
  dmg:   { name: '臂力训练', desc: '投掷伤害 +8/级', costs: [50, 90, 140, 200, 270], max: 5 },
  hp:    { name: '强身健体', desc: '生命上限 +80/级', costs: [60, 110, 170, 240], max: 4 },
  hooks: { name: '备用钩爪', desc: '每关钩子次数 +1', costs: [80, 130, 190], max: 3 },
};
const ROCKET_COST = 60, ROCKET_CAP = 3;
const heroDmg = () => 20 + 8 * save.upg.dmg;
const heroMaxHp = () => 580 + 80 * save.upg.hp;

/* ---------- 主题色 ---------- */
const THEMES = [
  { a: '#8fd3f4', b: '#eefaff', sea1: '#5db8e8', sea2: '#3a92c4', sun: '#ffd94d', sand: '#ecc98a', sand2: '#f4dc9f', road: '#5a626e', brick: '#d3724f', brick2: '#c4633f', cloud: '#ffffff' },
  { a: '#ffce8c', b: '#fff4dc', sea1: '#6fb8c8', sea2: '#4a92a8', sun: '#ff9d3c', sand: '#e8c184', sand2: '#f2d49c', road: '#635a4e', brick: '#cf6a45', brick2: '#bf5a38', cloud: '#fff7e8' },
  { a: '#a8a2f0', b: '#f2eaff', sea1: '#7a8ad0', sea2: '#5a6ab0', sun: '#f4f0d0', sand: '#c9b594', sand2: '#d6c6a4', road: '#4e5060', brick: '#b0685a', brick2: '#a05a4c', cloud: '#e8e2ff' },
  { a: '#f4a8b8', b: '#ffeff2', sea1: '#c88ab0', sea2: '#a86a94', sun: '#ffdf9e', sand: '#e9c4a0', sand2: '#f3d4b4', road: '#5e5260', brick: '#c66a72', brick2: '#b65a62', cloud: '#fff0f3' },
  { a: '#9be0c4', b: '#eefaf2', sea1: '#68b8a0', sea2: '#489880', sun: '#ffe08a', sand: '#e2cc8e', sand2: '#eeda9e', road: '#52625a', brick: '#c47a52', brick2: '#b46a44', cloud: '#ffffff' },
];
const THEME = () => THEMES[G.levelIdx % THEMES.length];

/* ---------- 工具 ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const approach = (v, t, step) => v + clamp(t - v, -step, step);
const solidState = b => !b.dead && (b.state === 'rest' || b.state === 'pull');

/* ---------- 全局状态 ---------- */
const G = {
  state: 'title',        // title | battle | victory | defeat | pause | upgrade
  phase: 'demo',         // demo(拆迁) | fight(战斗)
  levelIdx: 0, level: null,
  CELL: 40, rows: 0, cols: 0, originX: 0,
  bricks: [], zombies: [], projectiles: [],
  particles: [], floaters: [], pipeAnims: [], pendingBooms: [],
  hook: { uses: 0, max: 0, state: 'idle', target: null, t: 0 },
  hero: { hp: 0, ammo: 0, throwCd: 0, flash: 0, armT: 0, hurtT: 0 },
  collected: 0, total: 0,
  rockets: 0,
  waveIdx: 0, waveDelay: 0, waveTotal: 0, announce: null,
  shake: 0, time: 0, hintT: 0, demoDoneT: 0, victoryT: 0,
  nextIdx: 0,
};

const mouse = { x: 0, y: 0, over: false };
let hoverBrick = null;

/* ================================================================
   关卡加载
================================================================ */
function startLevel(idx) {
  idx = clamp(idx, 0, LEVELS.length - 1);
  const def = LEVELS[idx];
  G.levelIdx = idx;
  G.level = def;
  G.rows = def.grid.length;
  G.cols = def.grid[0].length;
  G.CELL = Math.min(40, Math.floor((ROAD_Y - 36) / G.rows));
  G.originX = BUILD_CX - (G.cols * G.CELL) / 2;

  G.bricks = [];
  G.zombies = [];
  G.projectiles = [];
  G.particles = [];
  G.floaters = [];
  G.pipeAnims = [];
  G.pendingBooms = [];

  for (let r = 0; r < G.rows; r++) {
    let c = 0;
    while (c < G.cols) {
      const ch = def.grid[r][c];
      if (ch === '.') { c++; continue; }
      let len = 1;
      if (ch === 'S') {
        // 楼板梁：一行里连续的 S 组成一整根刚性梁
        while (c + len < G.cols && def.grid[r][c + len] === 'S') len++;
      }
      G.bricks.push({
        col: c, row: r, len, type: ch,
        x: G.originX + c * G.CELL,
        y: ROAD_Y - (G.rows - r) * G.CELL,
        state: 'rest', vy: 0, fallStartY: 0,
        load: 0, off: 0, yankT: 0, yankDur: 0,
        flyT: 0, fx: 0, fy: 0, dead: false,
      });
      c += len;
    }
  }
  G.total = G.bricks.reduce((s, b) => s + b.len, 0);
  G.collected = 0;

  G.hook = { uses: def.pulls + save.upg.hooks, max: def.pulls + save.upg.hooks, state: 'idle', target: null, t: 0 };
  G.hero = { hp: heroMaxHp(), ammo: 0, throwCd: 0.3, flash: 0, armT: 0, hurtT: 0 };
  G.rockets = save.rockets;
  G.phase = 'demo';
  G.waveIdx = 0;
  G.waveTotal = def.waves;
  G.waveDelay = 0;
  G.announce = null;
  G.shake = 0;
  G.hintT = 6;
  G.demoDoneT = 0;
  G.victoryT = 0;

  G.state = 'battle';
  setOverlay(null);
  hud.classList.remove('hidden');
  skillBtn.classList.remove('hidden');
  updateHUD(true);
}

/* ================================================================
   结构支撑
   普通砖/钢梁/TNT：只靠【正下方】直接接触支撑（拉掉必塌）
   楼板梁 S：一整根刚性梁，任意一格下方有支撑即稳（失去全部支撑整根塌）
================================================================ */
function recomputeSupport() {
  const rest = G.bricks.filter(solidState);
  if (!rest.length) return;
  const rowKey = b => Math.round((ROAD_Y - b.y - G.CELL) / G.CELL);
  // 单元格索引：格子所在列 → 该格下方的实体
  const cellMap = new Map();
  for (const b of rest) {
    const rb = rowKey(b);
    for (let i = 0; i < b.len; i++) {
      cellMap.set((b.col + i) + '_' + rb, b);
    }
  }

  const held = new Set();
  for (const b of rest) {
    if (Math.abs(ROAD_Y - b.y - G.CELL) < 0.5) held.add(b);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of rest) {
      if (held.has(b)) continue;
      const rb = rowKey(b);
      let ok = false;
      // 任意一格的正下方有被支撑的实体（梁只需一格接触）
      for (let i = 0; i < b.len && !ok; i++) {
        const below = cellMap.get((b.col + i) + '_' + (rb - 1));
        if (below && below !== b && held.has(below)) ok = true;
      }
      if (ok) { held.add(b); changed = true; }
    }
  }
  for (const b of rest) {
    if (!held.has(b)) {
      b.state = 'falling';
      b.vy = 0;
      b.fallStartY = b.y;
    }
  }
}

function brickLoad(b) {
  let n = 0;
  for (const o of G.bricks) {
    if (o !== b && solidState(o) && o.y < b.y - 1) {
      // 与目标砖列重叠的都算压在上面的重量
      if (o.col < b.col + b.len && b.col < o.col + o.len) n++;
    }
  }
  return n;
}

/* ================================================================
   钩子拉砖
================================================================ */
function ropeDir(b) {
  const cx = b.x + G.CELL / 2, cy = b.y + G.CELL / 2;
  const dx = HOOK_ANCHOR.x - cx, dy = HOOK_ANCHOR.y - cy;
  const L = Math.hypot(dx, dy) || 1;
  return { x: dx / L, y: dy / L };
}

function tryPull(b) {
  if (G.state !== 'battle' || G.phase !== 'demo') return;
  if (G.hook.state !== 'idle') { addFloater(mouse.x, mouse.y - 10, '钩子忙', '#cfd8e6', 0.8); return; }
  if (!b || b.state !== 'rest') return;
  if (b.type === 'X' || b.type === 'S' || b.len > 1) return; // 钢梁/楼板拉不动
  if (G.hook.uses <= 0) { addFloater(mouse.x, mouse.y - 10, '钩子用完了', '#ff6b5e', 0.9); return; }

  G.hook.uses--;
  b.load = brickLoad(b);
  b.state = 'pull';
  b.off = 0;
  G.hook.target = b;
  G.hook.state = 'aim';
  G.hook.t = 0;
  Snd.click();
  recomputeSupport(); // 拉出的瞬间，上方失去支撑开始塌落
  updateHUD(true);
}

function updateHook(dt) {
  const hk = G.hook;
  const b = hk.target;
  if (hk.state === 'idle') return;
  if (b && b.dead) { hk.target = null; hk.state = 'return'; hk.t = 0; return; }

  if (hk.state === 'aim') {
    hk.t += dt / 0.22;
    if (hk.t >= 1) {
      hk.t = 0;
      hk.state = 'yank';
      b.yankT = 0;
      b.yankDur = (0.35 + 0.13 * b.load) / pullPowerMult();
      Snd.latch();
    }
  } else if (hk.state === 'yank') {
    b.yankT += dt;
    const p = clamp(b.yankT / b.yankDur, 0, 1);
    b.off = p * G.CELL * 0.9;
    if (Math.random() < dt * 14) {
      const v = brickVisual(b);
      burst(v.x + G.CELL / 2, v.y + G.CELL / 2, 2, { color: '#ffe08a', spd: 90, life: 0.3, size: 2.5, grav: 400 });
    }
    if (p >= 1) {
      collectBrick(b);
      hk.target = null;
      hk.state = 'return';
      hk.t = 0;
      Snd.pop();
    }
  } else if (hk.state === 'return') {
    hk.t += dt / 0.18;
    if (hk.t >= 1) hk.state = 'idle';
  }
}

function pullPowerMult() { return 1 + 0.3 * save.upg.dmg; } // 臂力同时加快拉砖

/* ---------- 收集（飞向漏斗）---------- */
function collectBrick(b) {
  const v = brickVisual(b);
  b.state = 'collect';
  b.fx = v.x;
  b.fy = v.y;
  b.flyT = 0;
}

function brickVisual(b) {
  let x = b.x, y = b.y;
  if (b.state === 'pull') {
    const d = ropeDir(b);
    x += d.x * b.off + rnd(-1.6, 1.6);
    y += d.y * b.off + rnd(-1.6, 1.6);
  }
  return { x, y };
}

/* ================================================================
   砖块物理：坠落 → 落地即被漏斗收集；TNT 坠落爆炸
================================================================ */
function updateBricks(dt) {
  const falling = G.bricks.filter(b => b.state === 'falling');
  falling.sort((a, b) => b.y - a.y);

  for (const b of falling) {
    b.vy += GRAV * dt;
    b.y += b.vy * dt;
    // 落点：任何一格下方最高的实体面（多格梁取最先接触的面）
    let landY = ROAD_Y;
    for (const o of G.bricks) {
      if (o === b || o.dead || !solidState(o)) continue;
      if (o.y < b.y + G.CELL - 1) continue; // 必须在下方
      if (o.col < b.col + b.len && b.col < o.col + o.len) {
        if (o.y < landY) landY = o.y;
      }
    }
    if (b.y + G.CELL >= landY) {
      b.y = landY - G.CELL;
      b.vy = 0;
      const tiles = Math.max(0, (landY - b.fallStartY - G.CELL) / G.CELL);
      G.shake = Math.max(G.shake, clamp(tiles * 2, 2, 9));
      burst(b.x + b.len * G.CELL / 2, b.y + G.CELL, 6 + tiles * 2, { color: '#cbb79a', spd: 100, life: 0.4, size: 3, grav: 500 });
      Snd.thud();
      if (b.type === 'T') {
        b.dead = true;
        queueBoom(b.x + G.CELL / 2, b.y + G.CELL / 2, 0.02);
      } else {
        collectBrick(b);
      }
    }
  }

  // 收集飞行
  for (const b of G.bricks) {
    if (b.state !== 'collect') continue;
    b.flyT += dt / 0.55;
    if (b.flyT >= 1) {
      b.dead = true;
      const gain = b.type === 'T' ? 2 * b.len : b.len;
      G.collected += b.len;
      G.hero.ammo += gain;
      addFloater(HOPPER.x, ROAD_Y - 6, '+' + gain, '#ffd94d', 0.8);
      for (let i = 0; i < Math.min(b.len, 5); i++) {
        G.pipeAnims.push({ t: -i * 0.12, color: (b.type === 'X' || b.type === 'S') ? '#9aa7b5' : '#e0a37e' });
      }
      Snd.coin();
    }
  }

  // 待爆炸
  for (const bm of G.pendingBooms) {
    bm.t -= dt;
    if (bm.t <= 0) { bm.done = true; explodeBricks(bm.x, bm.y); }
  }
  G.pendingBooms = G.pendingBooms.filter(b => !b.done);

  // 传送带动画
  for (const p of G.pipeAnims) p.t += dt / 0.8;
  G.pipeAnims = G.pipeAnims.filter(p => p.t < 1);

  G.bricks = G.bricks.filter(b => !b.dead);
}

function queueBoom(x, y, t) {
  for (const bm of G.pendingBooms) {
    if (Math.hypot(bm.x - x, bm.y - y) < G.CELL) return;
  }
  G.pendingBooms.push({ x, y, t });
}

function explodeBricks(x, y) {
  G.shake = Math.max(G.shake, 13);
  Snd.explode();
  burst(x, y, 26, { color: '#ff9d3c', spd: 260, life: 0.6, size: 4, grav: 300 });
  burst(x, y, 12, { color: '#4a4a4a', spd: 110, life: 0.9, size: 5, grav: 200 });
  const R = G.CELL * 1.7;
  for (const b of G.bricks) {
    if (b.dead || b.state === 'collect' || b.state === 'falling') continue;
    const bcx = b.x + b.len * G.CELL / 2, bcy = b.y + G.CELL / 2;
    const d = Math.hypot(bcx - x, bcy - y);
    if (d < R + b.len * G.CELL * 0.25) {
      if (b.type === 'T') {
        b.dead = true;
        queueBoom(bcx, bcy, 0.15);
      } else {
        collectBrick(b);
      }
    }
  }
  recomputeSupport();
}

/* ================================================================
   僵尸
================================================================ */
function spawnZombie(kind, wave) {
  const boss = kind === 'boss';
  const brute = kind === 'brute';
  const size = boss ? 62 : brute ? 48 : 38;
  let hp = Math.round((24 + G.levelIdx * 12 + wave * 6) * (brute ? 2 : 1));
  if (boss) hp = Math.round(150 + G.levelIdx * 40);
  G.zombies.push({
    kind, size,
    x: W + 40 + rnd(80),
    hp, maxHp: hp,
    dmg: boss ? 26 : Math.round((10 + G.levelIdx * 2) * (brute ? 1.6 : 1)),
    speed: boss ? 26 : 40 + rnd(20),
    atkCd: rnd(0.4, 1),
    state: 'walk', flash: 0, bob: rnd(Math.PI * 2), lunge: 0,
  });
}

function spawnWave(i) {
  const def = G.level;
  const n = Math.min(4, 1 + Math.floor((i + 1) / 2));
  for (let k = 0; k < n; k++) {
    const brute = !def.boss && i >= 2 && Math.random() < 0.22;
    spawnZombie(brute ? 'brute' : 'normal', i);
  }
  if (def.boss && i === def.waves - 1) spawnZombie('boss', i);
  setAnnounce(`第 ${i + 1} / ${def.waves} 波`);
  Snd.whoosh();
  updateHUD(true);
}

function setAnnounce(text) { G.announce = { text, t: 1.6 }; }

function damageZombie(z, dmg) {
  if (z.hp <= 0) return;
  z.hp -= Math.round(dmg);
  z.flash = 0.16;
  addFloater(z.x, BEACH_Y - z.size - 22, '-' + Math.round(dmg), '#ff5544', 0.8);
  Snd.hit();
  if (z.hp <= 0) {
    Snd.die();
    burst(z.x, BEACH_Y - z.size / 2, 16, { color: '#8fb573', spd: 170, life: 0.6, size: 4, grav: 500 });
    G.hero.ammo += 2;
    addFloater(z.x, BEACH_Y - z.size - 8, '+2砖', '#ffd94d', 1);
    updateHUD(true);
  }
}

function updateZombies(dt) {
  for (const z of G.zombies) {
    z.flash = Math.max(0, z.flash - dt * 4);
    z.bob += dt * 8;
    z.lunge = Math.max(0, z.lunge - dt * 4);
    if (z.hp <= 0) continue;

    const stopX = HERO_X + 34 + z.size * 0.55;
    if (z.state === 'walk') {
      z.x -= z.speed * dt;
      if (z.x <= stopX) z.state = 'attack';
    } else {
      z.atkCd -= dt;
      if (z.atkCd <= 0.25 && z.atkCd > 0) z.lunge = 1;
      if (z.atkCd <= 0) {
        z.atkCd = 1.1;
        G.hero.hp -= z.dmg;
        G.hero.flash = 0.35;
        G.hero.hurtT = 0.4;
        G.shake = Math.max(G.shake, 7);
        Snd.thud();
        addFloater(HERO_X, BEACH_Y - 66, '-' + z.dmg, '#ff6b5e', 0.9);
        updateHUD(true);
        if (G.hero.hp <= 0) { doDefeat('小人被僵尸打倒了！'); return; }
      }
    }
  }
  G.zombies = G.zombies.filter(z => z.hp > 0);
}

/* ================================================================
   小人自动投掷 + 火箭
================================================================ */
function updateHero(dt) {
  const h = G.hero;
  h.flash = Math.max(0, h.flash - dt * 3);
  h.hurtT = Math.max(0, h.hurtT - dt);
  h.armT = Math.max(0, h.armT - dt * 3);
  if (G.phase !== 'fight') return;

  h.throwCd -= dt;
  const alive = G.zombies.filter(z => z.hp > 0);
  if (alive.length && h.throwCd <= 0) {
    h.throwCd = 0.75;
    const target = alive.reduce((a, b) => (a.x < b.x ? a : b)); // 最靠前的
    const useBrick = h.ammo > 0;
    if (useBrick) h.ammo--;
    const dmg = heroDmg() * (useBrick ? 1 : 0.35);
    const T = 0.5;
    const sx = HERO_X + 8, sy = BEACH_Y - 58;
    const tx = clamp(target.x - target.speed * T, HERO_X + 50, W);
    const ty = BEACH_Y - target.size * 0.5;
    h.armT = 1;
    G.projectiles.push({
      kind: 'brick',
      sx, sy, vx: (tx - sx) / T, vy: (ty - sy) / T - 0.5 * GRAV * T,
      t: 0, T, target, dmg, brick: useBrick, rot: rnd(Math.PI * 2), dead: false,
    });
    if (useBrick) Snd.whoosh();
    updateHUD(false);
  }
}

function updateProjectiles(dt) {
  for (const p of G.projectiles) {
    p.t += dt;
    p.rot += dt * 9;
    if (p.t >= p.T) {
      p.dead = true;
      if (p.kind === 'brick') {
        const tx = p.sx + p.vx * p.T, ty = p.sy + p.vy * p.T + 0.5 * GRAV * p.T * p.T;
        burst(tx, ty, p.brick ? 7 : 4, { color: p.brick ? '#d8926e' : '#a89477', spd: 90, life: 0.35, size: 3, grav: 500 });
        if (p.target && p.target.hp > 0) damageZombie(p.target, p.dmg);
        else Snd.thud();
      } else if (p.kind === 'rocket') {
        const tx = p.sx + p.vx * p.T, ty = p.sy + p.vy * p.T + 0.5 * GRAV * p.T * p.T;
        G.shake = Math.max(G.shake, 12);
        Snd.explode();
        burst(tx, ty, 30, { color: '#ff9d3c', spd: 280, life: 0.6, size: 4, grav: 250 });
        burst(tx, ty, 14, { color: '#4a4a4a', spd: 120, life: 0.8, size: 5, grav: 150 });
        for (const z of G.zombies) {
          if (z.hp <= 0) continue;
          const d = Math.hypot(z.x - tx, BEACH_Y - z.size / 2 - ty);
          if (d < 140) damageZombie(z, 120 * (1 - d / 280));
        }
      }
    }
  }
  G.projectiles = G.projectiles.filter(p => !p.dead);
}

function fireRocket() {
  if (G.state !== 'battle' || G.phase !== 'fight') { addFloater(W / 2, 200, '拆迁阶段还不能用', '#cfd8e6', 1); return; }
  const alive = G.zombies.filter(z => z.hp > 0);
  if (!alive.length) return;
  if (G.rockets <= 0) { addFloater(W / 2, 200, '没有火箭了，去基地买', '#ff9d9d', 1); return; }
  G.rockets--;
  save.rockets = G.rockets;
  persist();
  const target = alive.reduce((a, b) => (a.x > b.x ? a : b)); // 最远的
  const T = 0.7;
  const sy = BEACH_Y - 70;
  G.projectiles.push({
    kind: 'rocket',
    sx: HERO_X, sy,
    vx: (target.x - HERO_X) / T,
    vy: ((BEACH_Y - 30) - sy - 0.5 * GRAV * T * T) / T,
    t: 0, T, rot: 0, dead: false,
  });
  Snd.whoosh();
  updateHUD(true);
}

/* ================================================================
   胜负
================================================================ */
function doVictory() {
  if (G.state !== 'battle') return;
  G.state = 'victory';
  Snd.win();
  const bonus = 20 + G.levelIdx * 8;
  const total = G.collected + bonus;
  save.bricks += total;
  save.maxLevel = Math.max(save.maxLevel, Math.min(G.levelIdx + 2, LEVELS.length));
  persist();
  for (let i = 0; i < 60; i++) {
    burst(rnd(W), rnd(-40, 100), 1, { color: ['#ffd94d', '#7fd3ff', '#ff8a8a', '#8ce99a'][i % 4], spd: 60, life: 2.2, size: 4, grav: 260 });
  }
  setOverlay(`
    <div class="panel">
      <h2>关卡完成！</h2>
      <p>僵尸全部消灭，小人安然无恙</p>
      <p>拆下砖块 <span class="stat">${G.collected}</span> &nbsp; 通关奖励 <span class="gold">+${bonus}</span></p>
      <p>本次共获得 <span class="gold">${total}</span> 砖块资源</p>
      <button class="btn" data-act="next">前往基地强化</button>
    </div>
  `);
}

function doDefeat(reason) {
  if (G.state !== 'battle') return;
  G.state = 'defeat';
  Snd.lose();
  save.bricks += G.collected;
  persist();
  setOverlay(`
    <div class="panel">
      <h2 style="color:#ff7d7d">任务失败</h2>
      <p>${reason}</p>
      <p>拆下的 <span class="stat">${G.collected}</span> 块砖已带回基地</p>
      <p>提示：去基地升级伤害和生命，或多买火箭！</p>
      <button class="btn" data-act="retry">回基地整备</button>
      <button class="btn gray" data-act="menu">回主菜单</button>
    </div>
  `);
}

/* ================================================================
   主更新
================================================================ */
function update(dt) {
  G.time += dt;
  updateParticles(dt);
  updateFloaters(dt);
  if (G.shake > 0) G.shake = Math.max(0, G.shake - 30 * dt);
  if (G.hintT > 0) G.hintT -= dt;
  if (G.announce) { G.announce.t -= dt; if (G.announce.t <= 0) G.announce = null; }

  if (G.state !== 'battle') return;

  updateHook(dt);
  updateBricks(dt);
  updateHero(dt);
  updateZombies(dt);
  updateProjectiles(dt);

  // 拆迁阶段结束 → 战斗阶段
  if (G.phase === 'demo') {
    const settled = G.hook.state === 'idle'
      && !G.bricks.some(b => b.state === 'falling' || b.state === 'collect')
      && !G.pendingBooms.length;
    const pullable = G.bricks.some(b => b.state === 'rest' && (b.type === '#' || b.type === 'T'));
    if (settled && (G.hook.uses <= 0 || !pullable)) {
      G.demoDoneT += dt;
      if (G.demoDoneT > 1) {
        G.phase = 'fight';
        G.waveDelay = 1.4;
        setAnnounce('僵尸来了！');
      }
    } else G.demoDoneT = 0;
  } else if (G.phase === 'fight') {
    // 波次推进
    if (G.waveDelay > 0) {
      G.waveDelay -= dt;
      if (G.waveDelay <= 0 && G.waveIdx < G.waveTotal) spawnWave(G.waveIdx++);
    } else if (G.zombies.length === 0) {
      if (G.waveIdx < G.waveTotal) G.waveDelay = 1.6;
      else {
        G.victoryT += dt;
        if (G.victoryT > 0.9) doVictory();
      }
    }
  }
  updateHUD(false);
}

/* ================================================================
   粒子 / 浮字
================================================================ */
function burst(x, y, n, opt = {}) {
  const { color = '#fff', spd = 120, life = 0.5, size = 3, grav = 400 } = opt;
  for (let i = 0; i < n; i++) {
    const a = rnd(Math.PI * 2);
    const s = rnd(0.3, 1) * spd;
    G.particles.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - spd * 0.3,
      life: rnd(0.6, 1) * life, maxLife: life,
      color: Array.isArray(color) ? color[i % color.length] : color,
      size: rnd(0.6, 1.2) * size, grav,
    });
  }
}
function updateParticles(dt) {
  for (const p of G.particles) {
    p.vy += p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  G.particles = G.particles.filter(p => p.life > 0);
}
function addFloater(x, y, text, color, life = 1) {
  G.floaters.push({ x, y, text, color, life, maxLife: life });
}
function updateFloaters(dt) {
  for (const f of G.floaters) { f.y -= 34 * dt; f.life -= dt; }
  G.floaters = G.floaters.filter(f => f.life > 0);
}

/* ================================================================
   渲染
================================================================ */
function render() {
  const t = THEME();
  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, t.a);
  sky.addColorStop(1, t.b);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 320);

  // 太阳
  ctx.fillStyle = t.sun;
  ctx.beginPath(); ctx.arc(868, 58, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.beginPath(); ctx.arc(868, 58, 42, 0, Math.PI * 2); ctx.fill();

  // 云
  ctx.fillStyle = t.cloud;
  for (let i = 0; i < 3; i++) {
    const cx = ((G.time * 8 + i * 360) % (W + 220)) - 110;
    const cy = 48 + i * 40;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 44, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 24, cy + 4, 28, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 远景楼群
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  for (let i = 0; i < 9; i++) {
    const bw = 60 + (i * 37) % 50;
    const bh = 40 + (i * 53) % 70;
    ctx.fillRect(i * 115 - 20, 300 - bh, bw, bh);
  }

  // 海
  const sea = ctx.createLinearGradient(0, 300, 0, 340);
  sea.addColorStop(0, t.sea1);
  sea.addColorStop(1, t.sea2);
  ctx.fillStyle = sea;
  ctx.fillRect(0, 300, W, 40);
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const wy = 306 + i * 6;
    const wx = ((G.time * 20 + i * 180) % (W + 120)) - 60;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.quadraticCurveTo(wx + 24, wy - 3, wx + 48, wy);
    ctx.stroke();
  }

  // 棕榈树
  drawPalm(305, 340, 0.9);
  drawPalm(912, 340, 1.1);

  ctx.save();
  if (G.shake > 0.2) ctx.translate(rnd(-G.shake, G.shake), rnd(-G.shake, G.shake));

  // 路面
  ctx.fillStyle = t.road;
  ctx.fillRect(0, ROAD_Y, W, 18);
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  for (let i = 0; i < 16; i++) ctx.fillRect(i * 64 + 10, ROAD_Y + 8, 30, 3);

  // 沙崖 + 沙滩
  ctx.fillStyle = t.sand;
  ctx.fillRect(0, ROAD_Y + 18, W, BEACH_Y - ROAD_Y - 18);
  ctx.fillStyle = t.sand2;
  ctx.fillRect(0, BEACH_Y, W, H - BEACH_Y);
  ctx.fillStyle = 'rgba(0,0,0,.07)';
  for (let i = 0; i < 20; i++) ctx.fillRect(i * 52 + 8, BEACH_Y + 12 + (i % 3) * 14, 18, 5);

  drawHopper();
  drawJeep();
  drawHook();
  drawBricks();
  drawHero();
  drawZombies();
  drawProjectiles();
  drawParticles();
  drawFloaters();
  drawHover();
  drawPipeAnims();

  ctx.restore();

  drawUI();
}

function drawPalm(x, baseY, s) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.scale(s, s);
  ctx.strokeStyle = '#9a7248';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(14, -70, 4, -130);
  ctx.stroke();
  ctx.fillStyle = '#4c9e58';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.55;
    ctx.beginPath();
    ctx.moveTo(4, -130);
    ctx.quadraticCurveTo(4 + Math.cos(a) * 55, -130 + Math.sin(a) * 55 - 12, 4 + Math.cos(a) * 88, -130 + Math.sin(a) * 88 + 6);
    ctx.quadraticCurveTo(4 + Math.cos(a) * 50, -130 + Math.sin(a) * 50 + 10, 4, -130);
    ctx.fill();
  }
  ctx.restore();
}

function drawHopper() {
  const hx = HOPPER.x, hw = HOPPER.w;
  // 漏斗
  ctx.fillStyle = '#3a4148';
  ctx.beginPath();
  ctx.moveTo(hx - hw / 2, ROAD_Y + 2);
  ctx.lineTo(hx + hw / 2, ROAD_Y + 2);
  ctx.lineTo(hx + 16, 402);
  ctx.lineTo(hx - 16, 402);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2b3238';
  ctx.fillRect(hx - hw / 2 - 6, ROAD_Y, hw + 12, 8);
  // 传送管
  ctx.strokeStyle = '#4a525c';
  ctx.lineWidth = 20;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx, 402);
  ctx.quadraticCurveTo(hx - 60, 428, 250, 442);
  ctx.quadraticCurveTo(190, 450, HERO_X + 6, 500);
  ctx.stroke();
  ctx.strokeStyle = '#5c666f';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(hx, 402);
  ctx.quadraticCurveTo(hx - 60, 428, 250, 442);
  ctx.quadraticCurveTo(190, 450, HERO_X + 6, 500);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawPipeAnims() {
  for (const p of G.pipeAnims) {
    const t = p.t;
    // 沿管道路径取点
    const pt = pipePoint(t);
    ctx.fillStyle = p.color;
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate(t * 6);
    ctx.fillRect(-6, -4, 12, 8);
    ctx.restore();
  }
}
function pipePoint(t) {
  // 分段二次贝塞尔近似
  const seg = t < 0.5 ? 0 : 1;
  const tt = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  if (seg === 0) {
    const p0 = { x: HOPPER.x, y: 402 }, p1 = { x: HOPPER.x - 60, y: 428 }, p2 = { x: 250, y: 442 };
    return bez(p0, p1, p2, tt);
  }
  const p0 = { x: 250, y: 442 }, p1 = { x: 190, y: 450 }, p2 = { x: HERO_X + 6, y: 500 };
  return bez(p0, p1, p2, tt);
}
function bez(p0, p1, p2, t) {
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

function drawJeep() {
  const y = ROAD_Y;
  ctx.fillStyle = '#5e7a3c';
  roundRect(196, y - 26, 118, 24, 6); ctx.fill();
  ctx.fillStyle = '#4c6630';
  roundRect(206, y - 40, 52, 18, 5); ctx.fill();
  // 炮塔
  ctx.fillStyle = '#3e5528';
  roundRect(238, y - 50, 30, 12, 4); ctx.fill();
  ctx.fillRect(266, y - 47, 34, 5);
  // 车轮
  ctx.fillStyle = '#26292e';
  ctx.beginPath();
  ctx.arc(220, y - 2, 12, 0, Math.PI * 2);
  ctx.arc(292, y - 2, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8b95a0';
  ctx.beginPath();
  ctx.arc(220, y - 2, 5, 0, Math.PI * 2);
  ctx.arc(292, y - 2, 5, 0, Math.PI * 2);
  ctx.fill();
  // 五角星
  ctx.fillStyle = '#ffd94d';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('★', 254, y - 10);
}

function drawHook() {
  const hk = G.hook;
  // 锚点立柱
  ctx.fillStyle = '#6b7580';
  ctx.fillRect(HOOK_ANCHOR.x - 5, HOOK_ANCHOR.y - 6, 10, ROAD_Y - HOOK_ANCHOR.y + 6);
  ctx.beginPath();
  ctx.arc(HOOK_ANCHOR.x, HOOK_ANCHOR.y - 8, 7, 0, Math.PI * 2);
  ctx.fill();

  const b = hk.target;
  if (hk.state !== 'idle' && (b || hk.state === 'return')) {
    let ex = HOOK_ANCHOR.x, ey = HOOK_ANCHOR.y;
    if (b) {
      const v = brickVisual(b);
      const tx = v.x + G.CELL / 2, ty = v.y + G.CELL / 2;
      let p = 1;
      if (hk.state === 'aim') p = clamp(hk.t, 0, 1);
      ex = HOOK_ANCHOR.x + (tx - HOOK_ANCHOR.x) * p;
      ey = HOOK_ANCHOR.y + (ty - HOOK_ANCHOR.y) * p;
    }
    // 绳子（麻绳质感）
    ctx.strokeStyle = '#a8742f';
    ctx.lineWidth = 4;
    ctx.setLineDash([9, 4]);
    ctx.beginPath();
    ctx.moveTo(HOOK_ANCHOR.x, HOOK_ANCHOR.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    // 钩子
    ctx.strokeStyle = '#dfe6ec';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(ex, ey + 5, 7, Math.PI * 0.15, Math.PI * 1.35);
    ctx.stroke();
  }
}

/* ---------- 砖块 ---------- */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBricks() {
  const t = THEME();
  const C = G.CELL;
  for (const b of G.bricks) {
    const w = b.len * C;
    let x = b.x, y = b.y, scale = 1, rot = 0, alpha = 1;

    if (b.state === 'collect') {
      const tt = b.flyT;
      const tx = HOPPER.x, ty = ROAD_Y + 6;
      const mx = (b.fx + tx) / 2, my = Math.min(b.fy, ty) - 90;
      x = (1 - tt) * (1 - tt) * b.fx + 2 * (1 - tt) * tt * mx + tt * tt * tx;
      y = (1 - tt) * (1 - tt) * b.fy + 2 * (1 - tt) * tt * my + tt * tt * ty;
      scale = 1 - 0.35 * tt;
      rot = tt * 2.2;
    } else if (b.state === 'pull') {
      const v = brickVisual(b);
      x = v.x; y = v.y;
    } else if (b.state === 'falling') {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = b.type === 'S' ? '#8a6db0' : t.brick;
      ctx.fillRect(b.x + 3, b.y - b.vy * 0.03, w - 6, C - 6);
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + w / 2, y + C / 2);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -C / 2);

    if (b.type === 'S') {
      // 楼板梁：一整根刚性梁
      ctx.fillStyle = '#8a6db0';
      roundRect(0, 1, w - 1, C - 2, 6); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillRect(4, 3, w - 9, 5);
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      ctx.fillRect(4, C - 9, w - 9, 5);
      ctx.strokeStyle = '#5e4780';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 7, 6); ctx.lineTo(w / 2 - 2, C - 6);
      ctx.moveTo(w / 2 + 5, 6); ctx.lineTo(w / 2 + 10, C - 6);
      ctx.stroke();
    } else {
      for (let i = 0; i < b.len; i++) {
        ctx.save();
        ctx.translate(i * C, 0);
        if (b.type === '#') {
          const alt = (Math.floor(b.y / C) + i) % 2 === 0;
          ctx.fillStyle = alt ? t.brick : t.brick2;
          roundRect(1, 1, C - 2, C - 2, 4); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.16)';
          ctx.fillRect(4, 3, C - 8, 4);
          ctx.fillStyle = 'rgba(0,0,0,.16)';
          ctx.fillRect(4, C - 8, C - 8, 4);
        } else if (b.type === 'X') {
          ctx.fillStyle = '#6f7d8c';
          roundRect(1, 1, C - 2, C - 2, 4); ctx.fill();
          ctx.strokeStyle = '#4d5966';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(6, C - 6); ctx.lineTo(C - 6, 6);
          ctx.stroke();
        } else { // TNT
          ctx.fillStyle = '#c0392b';
          roundRect(1, 1, C - 2, C - 2, 4); ctx.fill();
          ctx.fillStyle = '#1c1c24';
          ctx.beginPath();
          ctx.arc(C / 2, C / 2 + 2, C * 0.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffd94d';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(C / 2 + 4, C / 2 - 5);
          ctx.quadraticCurveTo(C / 2 + 10, C / 2 - 12, C / 2 + 8, C / 2 - 16);
          ctx.stroke();
          if (Math.floor(G.time * 6) % 2 === 0) {
            ctx.fillStyle = '#ffe08a';
            ctx.beginPath();
            ctx.arc(C / 2 + 8, C / 2 - 17, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }

    // 拉砖进度环
    if (b.state === 'pull') {
      const p = clamp(b.yankT / b.yankDur, 0, 1);
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(C / 2, C / 2, C * 0.66, -Math.PI / 2, Math.PI * 1.5);
      ctx.stroke();
      ctx.strokeStyle = '#7dff8a';
      ctx.beginPath();
      ctx.arc(C / 2, C / 2, C * 0.66, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ---------- 小人 ---------- */
function drawHero() {
  const h = G.hero;
  const x = HERO_X, footY = BEACH_Y;
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath();
  ctx.ellipse(x, footY + 4, 24, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  const bob = G.phase === 'fight' ? Math.abs(Math.sin(G.time * 10)) * 2 : Math.sin(G.time * 2.4) * 2;
  const y = footY - 58 + bob;
  const hurt = h.hurtT > 0 && Math.floor(G.time * 14) % 2 === 0;

  // 腿
  ctx.fillStyle = '#5a4632';
  ctx.fillRect(x - 10, y + 44, 8, 14);
  ctx.fillRect(x + 2, y + 44, 8, 14);
  // 身体
  ctx.fillStyle = hurt ? '#ff8a7a' : '#c68652';
  roundRect(x - 17, y + 12, 34, 34, 8); ctx.fill();
  // 头
  ctx.fillStyle = hurt ? '#ffb1a5' : '#f0c08c';
  roundRect(x - 16, y - 10, 32, 26, 9); ctx.fill();
  // 红头发
  ctx.fillStyle = '#e04b4b';
  ctx.beginPath();
  ctx.moveTo(x - 17, y - 4);
  ctx.arcTo(x - 17, y - 12, x - 9, y - 12, 6);
  ctx.lineTo(x + 8, y - 12);
  ctx.arcTo(x + 17, y - 12, x + 17, y - 4, 6);
  ctx.lineTo(x + 17, y - 2);
  ctx.quadraticCurveTo(x + 6, y - 10, x - 17, y - 2);
  ctx.fill();
  // 眼睛
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x - 5, y + 2, 4.5, 0, Math.PI * 2);
  ctx.arc(x + 6, y + 2, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(x - 4, y + 3, 2.2, 0, Math.PI * 2);
  ctx.arc(x + 7, y + 3, 2.2, 0, Math.PI * 2);
  ctx.fill();
  // 手臂（投掷动作）
  ctx.fillStyle = hurt ? '#ffb1a5' : '#f0c08c';
  if (h.armT > 0.4) {
    roundRect(x + 14, y - 8, 9, 20, 4); ctx.fill(); // 举臂
  } else {
    roundRect(x + 14, y + 16, 9, 20, 4); ctx.fill();
  }

  // 血条
  const bw = 62, ratio = clamp(h.hp / heroMaxHp(), 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  roundRect(x - bw / 2 - 2, y - 30, bw + 4, 12, 6); ctx.fill();
  ctx.fillStyle = '#e04545';
  ctx.fillRect(x - bw / 2, y - 28, bw * ratio, 8);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(Math.max(0, Math.ceil(h.hp)), x, y - 20);

  // 弹药
  ctx.fillStyle = '#e0a37e';
  ctx.fillRect(x - 26, footY - 12, 10, 7);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('×' + h.ammo, x - 4, footY - 6);
}

/* ---------- 僵尸 ---------- */
function drawZombies() {
  for (const z of G.zombies) {
    if (z.hp <= 0) continue;
    const size = z.size;
    const x = z.x;
    const lunge = z.lunge > 0 ? Math.sin(z.lunge * Math.PI) * 8 : 0;
    const y = BEACH_Y - size + Math.abs(Math.sin(z.bob)) * 3 - lunge * 0.5;

    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath();
    ctx.ellipse(x, BEACH_Y + 4, size * 0.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    let col = '#7aa05a';
    if (z.kind === 'brute') col = '#5c7a46';
    if (z.kind === 'boss') col = '#6a5a9e';

    // 身体（前倾僵尸姿态）
    ctx.save();
    ctx.translate(x + lunge * 0.4, y);
    ctx.rotate(-0.08 + Math.sin(z.bob) * 0.05);
    ctx.fillStyle = z.flash > 0 ? '#d8ffd8' : col;
    roundRect(-size / 2, 0, size, size * 0.9, 8); ctx.fill();
    // 前伸双臂
    ctx.fillStyle = z.flash > 0 ? '#d8ffd8' : col;
    roundRect(-size / 2 - 12, size * 0.18, 16, size * 0.16, 5); ctx.fill();
    roundRect(-size / 2 - 12, size * 0.42, 16, size * 0.16, 5); ctx.fill();
    // 眼睛
    const ey = size * 0.3, eo = size * 0.15;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-eo, ey, size * 0.11, 0, Math.PI * 2);
    ctx.arc(eo, ey, size * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a33';
    ctx.beginPath();
    ctx.arc(-eo - 2, ey + 1, size * 0.05, 0, Math.PI * 2);
    ctx.arc(eo - 2, ey + 1, size * 0.05, 0, Math.PI * 2);
    ctx.fill();
    // 嘴
    ctx.strokeStyle = '#2a3a22';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-size * 0.12, size * 0.55);
    ctx.lineTo(size * 0.12, size * 0.55);
    ctx.stroke();
    if (z.kind === 'boss') {
      ctx.fillStyle = '#ffd94d';
      ctx.beginPath();
      ctx.moveTo(-14, -2); ctx.lineTo(-14, -14); ctx.lineTo(-5, -5);
      ctx.lineTo(0, -16); ctx.lineTo(5, -5); ctx.lineTo(14, -14); ctx.lineTo(14, -2);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // 血条
    const bw = size + 10, ratio = clamp(z.hp / z.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    roundRect(x - bw / 2 - 2, y - 16, bw + 4, 12, 6); ctx.fill();
    ctx.fillStyle = '#6fd86f';
    ctx.fillRect(x - bw / 2, y - 14, bw * ratio, 8);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(z.hp), x, y - 6);
  }
}

/* ---------- 投射物 ---------- */
function drawProjectiles() {
  for (const p of G.projectiles) {
    const x = p.sx + p.vx * p.t;
    const y = p.sy + p.vy * p.t + 0.5 * GRAV * p.t * p.t;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.rot);
    if (p.kind === 'brick') {
      ctx.fillStyle = p.brick ? '#d8926e' : '#a89477';
      roundRect(-9, -5, 18, 10, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.fillRect(-6, -3, 12, 3);
    } else {
      ctx.fillStyle = '#c0392b';
      roundRect(-11, -5, 22, 10, 4); ctx.fill();
      ctx.fillStyle = '#ffd94d';
      ctx.beginPath();
      ctx.moveTo(11, -3); ctx.lineTo(18, 0); ctx.lineTo(11, 3);
      ctx.closePath(); ctx.fill();
      if (Math.random() < 0.6) {
        ctx.fillStyle = 'rgba(255,180,80,.6)';
        ctx.fillRect(-16 + rnd(4), -3 + rnd(4), 5, 5);
      }
    }
    ctx.restore();
  }
}

function drawParticles() {
  for (const p of G.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawFloaters() {
  ctx.textAlign = 'center';
  for (const f of G.floaters) {
    ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#000';
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawHover() {
  if (G.state !== 'battle' || G.phase !== 'demo' || !hoverBrick || !mouse.over) return;
  const b = hoverBrick;
  if (b.state !== 'rest') return;
  const C = G.CELL;
  const wpx = b.len * C;
  const fixed = b.type === 'X' || b.type === 'S' || b.len > 1;
  const load = fixed ? 0 : brickLoad(b);
  let col = '#7dff8a';
  if (load >= 3) col = '#ffd94d';
  if (load >= 6) col = '#ff6b5e';
  if (fixed) col = '#9aa7b5';
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(b.x - 1.5, b.y - 1.5, wpx + 3, C + 3);
  ctx.setLineDash([]);
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  const label = b.type === 'S' ? '楼板·拉不动' : b.type === 'X' ? '钢梁·拉不动' : (b.type === 'T' ? '炸药·承重 ' + load : '承重 ' + load);
  const tw = ctx.measureText(label).width + 14;
  const lx = clamp(b.x + wpx / 2, tw / 2 + 4, W - tw / 2 - 4);
  ctx.fillStyle = 'rgba(0,0,0,.65)';
  roundRect(lx - tw / 2, b.y - 26, tw, 19, 8); ctx.fill();
  ctx.fillStyle = col;
  ctx.fillText(label, lx, b.y - 12);
}

/* ---------- 画布 UI ---------- */
function drawUI() {
  if (G.state !== 'battle') return;
  // 阶段文字
  ctx.textAlign = 'center';
  ctx.font = 'bold 19px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.lineWidth = 4;
  const phaseText = G.phase === 'demo' ? '拆迁阶段 · 点击建筑拉砖' : '防守阶段';
  ctx.strokeText(phaseText, W / 2, 58);
  ctx.fillText(phaseText, W / 2, 58);

  // 拆迁进度条
  if (G.phase === 'demo') {
    const bw = 230, bx = W / 2 - bw / 2, by = 68;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    roundRect(bx - 3, by - 3, bw + 6, 20, 10); ctx.fill();
    const pct = G.total ? clamp(G.collected / G.total, 0, 1) : 0;
    ctx.fillStyle = '#ffd94d';
    ctx.fillRect(bx, by, bw * pct, 14);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(Math.floor(pct * 100) + '%', W / 2, by + 11);
  }

  // 波次公告
  if (G.announce) {
    const a = clamp(G.announce.t / 1.6, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = 'bold 34px sans-serif';
    ctx.fillStyle = '#ffd94d';
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 6;
    ctx.strokeText(G.announce.text, W / 2, 150);
    ctx.fillText(G.announce.text, W / 2, 150);
    ctx.globalAlpha = 1;
  }

  // 钩子次数
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = G.hook.uses > 0 ? '#fff' : '#ff9d9d';
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.lineWidth = 4;
  const hookText = `钩 ${G.hook.uses}/${G.hook.max}`;
  ctx.strokeText(hookText, HOOK_ANCHOR.x, HOOK_ANCHOR.y - 24);
  ctx.fillText(hookText, HOOK_ANCHOR.x, HOOK_ANCHOR.y - 24);

  // 提示
  if (G.phase === 'demo' && G.hintT > 0 && G.level) {
    const alpha = clamp(G.hintT, 0, 1);
    ctx.globalAlpha = alpha * 0.92;
    ctx.font = 'bold 14px sans-serif';
    const text = G.level.hint;
    const tw = ctx.measureText(text).width + 28;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    roundRect(W / 2 - tw / 2, 98, tw, 26, 10); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, W / 2, 115);
    ctx.globalAlpha = 1;
  }
}

/* ================================================================
   HUD / 面板
================================================================ */
let hudT = 0;
function updateHUD(force) {
  if (!force && G.time - hudT < 0.15) return;
  hudT = G.time;
  if (!G.level) return;
  hLevel.textContent = G.level.name;
  hHooks.textContent = '钩子 ×' + G.hook.uses;
  hHooks.style.color = G.hook.uses <= 1 ? '#ff9d9d' : '#fff';
  hBricks.textContent = '砖块 ×' + (save.bricks + G.collected);
  const alive = G.zombies.filter(z => z.hp > 0).length;
  hEnemy.textContent = '僵尸 ×' + alive;
  hEnemy.style.color = alive > 0 ? '#ff9d9d' : '#9dff9d';
  skillCount.textContent = '×' + G.rockets;
  skillBtn.classList.toggle('ready', G.rockets > 0 && G.phase === 'fight');
  const ratio = clamp(G.hero.hp / heroMaxHp(), 0, 1);
  hpFill.style.width = (ratio * 100) + '%';
  hpFill.style.background = ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#e6b93c' : '#e05252';
}

function setOverlay(html) {
  if (html == null) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
  else { overlay.innerHTML = html; overlay.classList.remove('hidden'); }
}

function showTitle() {
  G.state = 'title';
  G.level = null;
  hud.classList.add('hidden');
  skillBtn.classList.add('hidden');
  setOverlay(`
    <div class="panel">
      <h1>拆 迁 小 队</h1>
      <p>拉砖块 · 坍塌收集 · 大战僵尸</p>
      <div class="tiplist">
        <p><b>阶段一 拆迁：</b>点击建筑上的砖块，钩子把它拉出来，<br>塌落的砖块全部掉进漏斗，变成小人的<b>投掷弹药</b></p>
        <p><b>策略：</b>钩子次数有限，拉关键支撑，塌得越多弹药越多！</p>
        <p><b>阶段二 战斗：</b>钩子用完后僵尸一波波进攻，<br>小人自动扔砖块，消灭全部波次即通关</p>
        <p><b>养成：</b>砖块资源可升级伤害/生命/钩爪，还能买火箭</p>
      </div>
      <div class="lvgrid">
        ${LEVELS.map((lv, i) => `<button class="lvbtn ${i < save.maxLevel ? '' : 'locked'}" data-act="pick" data-level="${i + 1}" ${i < save.maxLevel ? '' : 'disabled'}>${i + 1}</button>`).join('')}
      </div>
      <p class="gold">资源：${save.bricks} 砖 &nbsp;|&nbsp; 进度：第 ${save.maxLevel} 关</p>
      <button class="btn" data-act="start">开始闯关</button>
      <button class="btn gray small" data-act="reset">重置进度</button>
    </div>
  `);
}

function showUpgrade() {
  G.state = 'upgrade';
  hud.classList.add('hidden');
  skillBtn.classList.add('hidden');
  const canFight = G.nextIdx < LEVELS.length;
  const nextName = canFight ? LEVELS[G.nextIdx].name : '';
  setOverlay(`
    <div class="panel">
      <h2>基地强化</h2>
      <p class="gold">砖块资源：${save.bricks}</p>
      <div class="cards">
        ${cardHTML('dmg')}
        ${cardHTML('hp')}
        ${cardHTML('hooks')}
        ${rocketCardHTML()}
      </div>
      <p>下一场：${nextName || '全部通关！'} &nbsp; 随身火箭：${save.rockets}</p>
      ${canFight
        ? `<button class="btn" data-act="fight">出击 · ${nextName}</button>`
        : `<button class="btn" data-act="fight">再战最终关</button>`}
      <button class="btn gray" data-act="menu">回主菜单</button>
    </div>
  `);
}

function cardHTML(key) {
  const u = UPG[key];
  const lv = save.upg[key];
  const maxed = lv >= u.max;
  const cost = maxed ? 0 : u.costs[lv];
  const afford = !maxed && save.bricks >= cost;
  return `
    <div class="card">
      <h3>${u.name}</h3>
      <p>${u.desc}</p>
      <div class="lv">等级 ${lv} / ${u.max}</div>
      <button class="btn ${afford ? '' : 'gray'}" data-act="buy-${key}" ${afford ? '' : 'disabled'}>
        ${maxed ? '已满级' : '花 ' + cost + ' 砖升级'}
      </button>
    </div>
  `;
}

function rocketCardHTML() {
  const afford = save.bricks >= ROCKET_COST && save.rockets < ROCKET_CAP;
  return `
    <div class="card">
      <h3>火箭补给</h3>
      <p>战斗中点击右下角发射，范围轰炸</p>
      <div class="lv">持有 ${save.rockets} / ${ROCKET_CAP}</div>
      <button class="btn ${afford ? '' : 'gray'}" data-act="buy-rocket" ${afford ? '' : 'disabled'}>
        花 ${ROCKET_COST} 砖买 1 发
      </button>
    </div>
  `;
}

function showFinalWin() {
  setOverlay(`
    <div class="panel">
      <h1>通 关 ！</h1>
      <p>你带领拆迁小队守住了每一片海滩！</p>
      <p class="gold">当前资源：${save.bricks} 砖</p>
      <button class="btn" data-act="menu">回主菜单</button>
      <button class="btn gray" data-act="fight">再战最终关</button>
    </div>
  `);
  G.state = 'upgrade';
  G.nextIdx = LEVELS.length - 1;
}

function showPause() {
  if (G.state !== 'battle') return;
  G.state = 'pause';
  setOverlay(`
    <div class="panel">
      <h2>暂停</h2>
      <p>${G.level.name} · 钩子 ${G.hook.uses}/${G.hook.max} · 弹药 ${G.hero.ammo} · 生命 ${Math.max(0, Math.ceil(G.hero.hp))}</p>
      <button class="btn" data-act="resume">继续游戏</button>
      <button class="btn gray" data-act="restart">重新本关</button>
      <button class="btn gray" data-act="menu">回主菜单</button>
    </div>
  `);
}

overlay.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  Snd.unlock();
  Snd.click();
  switch (act) {
    case 'start':
      G.nextIdx = Math.min(save.maxLevel - 1, LEVELS.length - 1);
      showUpgrade();
      break;
    case 'pick':
      G.nextIdx = clamp(+el.dataset.level - 1, 0, LEVELS.length - 1);
      showUpgrade();
      break;
    case 'fight':
      startLevel(G.nextIdx);
      break;
    case 'buy-dmg': case 'buy-hp': case 'buy-hooks': {
      const key = act.slice(4);
      const u = UPG[key];
      const lv = save.upg[key];
      if (lv < u.max && save.bricks >= u.costs[lv]) {
        save.bricks -= u.costs[lv];
        save.upg[key]++;
        persist();
        Snd.coin();
        showUpgrade();
      }
      break;
    }
    case 'buy-rocket':
      if (save.bricks >= ROCKET_COST && save.rockets < ROCKET_CAP) {
        save.bricks -= ROCKET_COST;
        save.rockets++;
        persist();
        Snd.coin();
        showUpgrade();
      }
      break;
    case 'next':
      G.nextIdx = G.levelIdx + 1;
      if (G.nextIdx >= LEVELS.length) showFinalWin();
      else showUpgrade();
      break;
    case 'retry':
      G.nextIdx = G.levelIdx;
      showUpgrade();
      break;
    case 'resume':
      if (G.state === 'pause') { G.state = 'battle'; setOverlay(null); }
      break;
    case 'restart':
      startLevel(G.levelIdx);
      break;
    case 'menu':
      showTitle();
      break;
    case 'reset':
      localStorage.removeItem(SAVE_KEY);
      save = defaultSave();
      persist();
      showTitle();
      break;
  }
});

/* ================================================================
   输入
================================================================ */
function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (W / r.width),
    y: (e.clientY - r.top) * (H / r.height),
  };
}

function findBrickAt(x, y) {
  for (const b of G.bricks) {
    if (b.dead) continue;
    if (b.state !== 'rest') continue;
    if (x >= b.x && x < b.x + b.len * G.CELL && y >= b.y && y < b.y + G.CELL) return b;
  }
  return null;
}

canvas.addEventListener('pointermove', (e) => {
  const p = canvasPos(e);
  mouse.x = p.x; mouse.y = p.y; mouse.over = true;
  hoverBrick = findBrickAt(p.x, p.y);
});
canvas.addEventListener('pointerleave', () => { mouse.over = false; hoverBrick = null; });
canvas.addEventListener('pointerdown', (e) => {
  if (G.state !== 'battle' || G.phase !== 'demo') return;
  Snd.unlock();
  const p = canvasPos(e);
  mouse.x = p.x; mouse.y = p.y;
  tryPull(findBrickAt(p.x, p.y));
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

skillBtn.addEventListener('click', () => {
  Snd.unlock();
  fireRocket();
});

pauseBtn.addEventListener('click', () => {
  if (G.state === 'battle') showPause();
  else if (G.state === 'pause') { G.state = 'battle'; setOverlay(null); }
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'p' || k === 'escape') {
    if (G.state === 'battle') showPause();
    else if (G.state === 'pause') { G.state = 'battle'; setOverlay(null); }
  } else if (k === 'm') {
    Snd.toggle();
  } else if (k === 'b' && G.state === 'battle') {
    fireRocket();
  } else if (k === 'r' && (G.state === 'battle' || G.state === 'pause')) {
    startLevel(G.levelIdx);
  }
});

/* ================================================================
   主循环
================================================================ */
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - lastT) / 1000);
  lastT = now;
  update(dt);
  if (G.level) render();
  else renderTitleBg();
  requestAnimationFrame(loop);
}

function renderTitleBg() {
  const t = THEMES[0];
  const sky = ctx.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, t.a);
  sky.addColorStop(1, t.b);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 320);
  ctx.fillStyle = t.sun;
  ctx.beginPath(); ctx.arc(868, 58, 30, 0, Math.PI * 2); ctx.fill();
  const sea = ctx.createLinearGradient(0, 300, 0, 340);
  sea.addColorStop(0, t.sea1); sea.addColorStop(1, t.sea2);
  ctx.fillStyle = sea;
  ctx.fillRect(0, 300, W, 40);
  ctx.fillStyle = t.road;
  ctx.fillRect(0, ROAD_Y, W, 18);
  ctx.fillStyle = t.sand;
  ctx.fillRect(0, ROAD_Y + 18, W, BEACH_Y - ROAD_Y - 18);
  ctx.fillStyle = t.sand2;
  ctx.fillRect(0, BEACH_Y, W, H - BEACH_Y);
  drawPalm(305, 340, 0.9);
  drawPalm(912, 340, 1.1);
  // 装饰小楼
  ctx.fillStyle = t.brick;
  const C = 34;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5 - Math.floor(r / 2); c++) {
      ctx.fillRect(600 + c * C + (r % 2) * 12, ROAD_Y - (r + 1) * C, C - 4, C - 4);
    }
  }
}

requestAnimationFrame(loop);
showTitle();
})();
