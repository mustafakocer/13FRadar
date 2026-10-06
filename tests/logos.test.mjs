// The logo harvest's rules (api/_lib/logoScrape.js): robots.txt is obeyed,
// only images with a 64px shorter side count, favicon-size icons do not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, robotsAllows, imageInfo, usable, hostOf, rootDomain, sponsorDomain } from '../api/_lib/logoScrape.js';

const png = (w, h) => { const b = Buffer.alloc(33); b.write('\x89PNG\r\n\x1a\n', 0, 'binary'); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const gif = (w, h) => { const b = Buffer.alloc(16); b.write('GIF89a', 0); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; };
const ico = (sizes) => { const b = Buffer.alloc(6 + 16 * sizes.length); b.writeUInt16LE(1, 2); b.writeUInt16LE(sizes.length, 4); sizes.forEach((s, i) => { b[6 + i * 16] = s === 256 ? 0 : s; b[7 + i * 16] = s === 256 ? 0 : s; }); return b; };

test('image sniff: format and pixel size', () => {
  assert.deepEqual(imageInfo(png(180, 180)), { ext: 'png', w: 180, h: 180 });
  assert.deepEqual(imageInfo(gif(64, 48)), { ext: 'gif', w: 64, h: 48 });
  assert.deepEqual(imageInfo(ico([16, 32])), { ext: 'ico', w: 32, h: 32 });
  assert.equal(imageInfo(ico([16, 256])).w, 256);
  assert.equal(imageInfo(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')).ext, 'svg');
  assert.equal(imageInfo(Buffer.from('<html><body>not an image</body></html>')), null);
});

test('usable: 64px shorter side; og:image must be near-square', () => {
  assert.ok(usable(imageInfo(png(180, 180))));
  assert.ok(!usable(imageInfo(png(32, 32))), 'a favicon-size icon is not a logo');
  assert.ok(!usable(imageInfo(gif(64, 48))), 'shorter side under 64');
  assert.ok(usable(imageInfo(png(1200, 630))), 'a banner passes the plain size rule');
  assert.ok(!usable(imageInfo(png(1200, 630)), { square: true }), 'but not as an og:image logo');
  assert.ok(usable(imageInfo(png(400, 320)), { square: true }));
});

test('robots.txt: our group wins over *, longest rule wins, no file means allowed', () => {
  const txt = `User-agent: *\nDisallow: /\n\nUser-agent: FundocapBot\nDisallow: /private/\nAllow: /private/logo/\n`;
  const r = parseRobots(txt);
  assert.ok(robotsAllows(r, '/'));
  assert.ok(!robotsAllows(r, '/private/x.png'));
  assert.ok(robotsAllows(r, '/private/logo/x.png'));
  const star = parseRobots('User-agent: *\nDisallow: /assets/\n');
  assert.ok(!robotsAllows(star, '/assets/icon.png'));
  assert.ok(robotsAllows(star, '/apple-touch-icon.png'));
  assert.ok(robotsAllows(parseRobots(''), '/anything'));
});

test('hostOf: filing / profile website strings → bare host', () => {
  assert.equal(hostOf('https://www.apple.com/'), 'apple.com');
  assert.equal(hostOf('investor.nvidia.com'), 'investor.nvidia.com');
  assert.equal(hostOf('WWW.Microsoft.COM'), 'microsoft.com');
  assert.equal(hostOf(''), null);
  assert.equal(hostOf('n/a'), null, 'no dot is not a host');
  assert.equal(hostOf('mailto:ir@x.com'), null);
});

test('rootDomain: the brand root, two-level ccTLDs kept', () => {
  assert.equal(rootDomain('corporate.walmart.com'), 'walmart.com');
  assert.equal(rootDomain('https://ir.kkr.com/'), 'kkr.com');
  assert.equal(rootDomain('usa.visa.com'), 'visa.com');
  assert.equal(rootDomain('mn.my.xcelenergy.com'), 'xcelenergy.com');
  assert.equal(rootDomain('www.bp.co.uk'), 'bp.co.uk');
  assert.equal(rootDomain('apple.com'), 'apple.com');
  assert.equal(rootDomain(''), null);
});

test('sponsorDomain: ETF / trust issuers map to the sponsor brand', () => {
  assert.equal(sponsorDomain('ISHARES TR'), 'ishares.com');
  assert.equal(sponsorDomain('VANGUARD INDEX FDS'), 'vanguard.com');
  assert.equal(sponsorDomain('STATE STR SPDR S&P 500 ETF'), 'ssga.com');
  assert.equal(sponsorDomain('SPDR GOLD TR'), 'spdrgoldshares.com');
  assert.equal(sponsorDomain('SELECT SECTOR SPDR TR'), 'ssga.com');
  assert.equal(sponsorDomain('INVESCO QQQ TR'), 'invesco.com');
  assert.equal(sponsorDomain('NVIDIA CORPORATION'), null);
  assert.equal(sponsorDomain(''), null);
});
