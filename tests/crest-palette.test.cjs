const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('const bins=[100,');
const end = html.indexOf("document.getElementById('legend').innerHTML=crestKeyMarkup();", start);
assert.ok(start >= 0 && end > start, 'CREST palette and legend helpers exist');
const source = html.slice(start, end);
const {bins, colors, color, crestKeyMarkup} = vm.runInNewContext(
  `(()=>{${source};return {bins,colors,color,crestKeyMarkup}})()`
);
assert.equal(bins.length, 14);
assert.equal(colors.length, bins.length);
for (let i = 1; i < bins.length; i++) assert.ok(bins[i] > bins[i - 1], 'bins are strictly increasing');
assert.equal(color(99.9), null);
assert.equal(color(100), colors[0]);
assert.equal(color(199.9), colors[0]);
assert.equal(color(200), colors[1]);
assert.equal(color(5999.9), colors[12]);
assert.equal(color(6000), '#ffffff');
assert.equal(color(9000), '#ffffff');
assert.equal(color(null), null);
assert.equal(color(NaN), null);
const legend = crestKeyMarkup();
assert.equal((legend.match(/crest-key-item/g) || []).length, 14);
assert.match(legend, /100–199/);
assert.match(legend, /6,000\\+/);
assert.match(html, /threshold:bins\\[0\\]/);
assert.match(html, /crestMapLegend\\.getContainer\\(\\)\\.hidden=!crest/);
assert.match(html, /Below 100 not displayed/);
console.log('CREST palette and on-map legend tests passed');
