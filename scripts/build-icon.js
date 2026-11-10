const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;

async function buildIcon() {
  const root = path.resolve(__dirname, '..');
  const svgPath = path.join(root, 'assets', 'icon.svg');
  const pngPath = path.join(root, 'assets', 'icon.png');
  const icoPath = path.join(root, 'assets', 'icon.ico');
  const svg = await fs.readFile(svgPath);
  await sharp(svg).resize(512, 512).png().toFile(pngPath);
  const ico = await pngToIco(pngPath);
  await fs.writeFile(icoPath, ico);
  console.log(`Created ${icoPath}`);
}

buildIcon().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
