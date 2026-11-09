// 打包 plugins/<name>/ 和 themes/<name>/ 为 dist/<name>-<version>.zip, 并生成 XArrPay 应用源 source.json
// 用法: node build.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const REPO = 'HunterWangwei/xarr-plugins';
const BRANCH = 'main';
const STORE_NAME = 'HunterWangwei-xarr-plugins';
const AUTHOR = 'HunterWangwei';
// 应用源基址: raw.githubusercontent.com 和 jsDelivr 各生成一份
const BASES = {
  'source.json': `https://raw.githubusercontent.com/${REPO}/${BRANCH}`,
  'source-cdn.json': `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}`,
};
// 打包时排除的文件
const EXCLUDE = new Set(['README.md']);

const root = __dirname;
const pluginsDir = path.join(root, 'plugins');
const distDir = path.join(root, 'dist');

// 最小 zip 写入(deflate), 避免依赖外部工具
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, mtime } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const d = mtime;
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// 由插件名生成固定 uuid, 保证版本更新后应用商店识别为同一插件
function stableUuid(name) {
  const h = crypto.createHash('sha1').update(`${REPO}/${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// 递归列出目录下的文件(相对路径, 用 / 分隔)
function listFiles(dir, rel = '') {
  const out = [];
  for (const file of fs.readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${file}` : file;
    if (fs.statSync(path.join(dir, r)).isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out;
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir);

// plugins/ 放支付插件, themes/ 放支付主题, 打包方式相同
const sources = [];
for (const [kind, kindDir] of [['plugins', pluginsDir], ['themes', path.join(root, 'themes')]]) {
  if (!fs.existsSync(kindDir)) continue;
  for (const name of fs.readdirSync(kindDir).sort()) sources.push({ kind, name, dir: path.join(kindDir, name) });
}

const plugins = [];
for (const { kind, name, dir } of sources) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (m.name !== name) throw new Error(`${name}: manifest.name 必须与目录名一致`);

  const entries = [];
  let latest = 0;
  for (const file of listFiles(dir)) {
    if (EXCLUDE.has(file)) continue;
    const full = path.join(dir, file);
    const st = fs.statSync(full);
    latest = Math.max(latest, st.mtimeMs);
    entries.push({ name: `${name}/${file}`, data: fs.readFileSync(full), mtime: st.mtime });
  }
  const zipName = `${name}-${m.version}.zip`;
  fs.writeFileSync(path.join(distDir, zipName), makeZip(entries));
  plugins.push({ m, kind, zipName, updateTime: Math.floor(latest / 1000) });
  console.log(`打包 ${zipName}`);
}

for (const [file, base] of Object.entries(BASES)) {
  const source = {
    code: 200,
    message: 'ok',
    data: {
      name: STORE_NAME,
      author: AUTHOR,
      plugins: plugins.map(({ m, kind, zipName, updateTime }) => ({
        uuid: stableUuid(m.name),
        title: m.title,
        name: m.name,
        type: m.type,
        description: m.description || '',
        version: m.version,
        min_program_version: m.min_program_version || '',
        author: m.author || AUTHOR,
        homepage: `https://github.com/${REPO}/tree/${BRANCH}/${kind}/${m.name}`,
        preview_url: '',
        preview_img_url: m.screenshot ? `${base}/${kind}/${m.name}/${m.screenshot}` : '',
        external_support_url: '',
        external_repository_url: `https://github.com/${REPO}`,
        download_url: `${base}/dist/${zipName}`,
        download_install_type: 2,
        app_url: '',
        amount: 0,
        pay_status: 0,
        source_site: `https://github.com/${REPO}`,
        update_time: updateTime,
      })),
    },
  };
  fs.writeFileSync(path.join(root, file), JSON.stringify(source, null, 2) + '\n');
  console.log(`生成 ${file}`);
}
