const sharp = require('sharp');
const sizes = [256, 128, 64, 48, 32, 16];
const input = 'assets/VoidDesk.png';
const output = 'assets/voiddesk.ico';

sharp(input)
  .resize(256, 256) // largest size for base
  .toFile('tmp-256.png', async err => {
    if (err) throw err;
    const images = await Promise.all(
      sizes.map(size => sharp(input).resize(size, size).png().toBuffer())
    );
    require('fs').writeFileSync(output, Buffer.concat(images));
    console.log('ICO generated:', output);
  });
