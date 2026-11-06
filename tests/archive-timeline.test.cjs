const assert = require('node:assert/strict');
const {createArchiveTimeline} = require('../archive-timeline.js');

const timeline = createArchiveTimeline();
const rain = ['2026-10-31T18:00:00Z', '2026-10-31T19:00:00Z', '2026-10-31T21:00:00Z'].map(utc => ({utc}));
const crest = ['2026-10-31T18:10:00Z', '2026-10-31T18:20:00Z', '2026-10-31T19:00:00Z'].map(utc => ({utc}));

assert.deepEqual(timeline.build('rainfall', rain, crest), rain.map(row => new Date(row.utc).toISOString()));
assert.deepEqual(timeline.build('crest', rain, crest), crest.map(row => new Date(row.utc).toISOString()));
assert.deepEqual(timeline.build('swipe', rain, crest), [
  '2026-10-31T18:00:00.000Z', '2026-10-31T18:10:00.000Z', '2026-10-31T18:20:00.000Z',
  '2026-10-31T19:00:00.000Z', '2026-10-31T21:00:00.000Z'
]);
assert.deepEqual(timeline.build('swipe', [...rain, rain[0]], crest), timeline.build('swipe', rain, crest), 'union removes duplicate native timestamps');

assert.deepEqual(timeline.resolveRainfall(rain, '2026-10-31T20:00:00Z'), {index: 1, validUtc: rain[1].utc});
assert.equal(timeline.resolveRainfall(rain, '2026-10-31T17:59:00Z'), null);
assert.deepEqual(timeline.resolveCrest(crest, '2026-10-31T18:20:00Z'), {index: 1, validUtc: crest[1].utc});
assert.equal(timeline.resolveCrest(crest, '2026-10-31T18:30:00Z'), null);
assert.equal(timeline.nearest(crest, '2026-10-31T18:15:00Z'), 0, 'ties choose the earlier native frame');
assert.equal(timeline.nearest(crest, '2026-10-31T18:18:00Z'), 1);
assert.deepEqual(timeline.build('swipe', [{utc:'2026-10-31T18:00:00+00:00'}], [{utc:'2026-10-31T18:00:00Z'}]), ['2026-10-31T18:00:00.000Z'], 'equivalent UTC spellings share one playback frame');
assert.deepEqual(timeline.resolveCrest([{utc:'2026-10-31T18:10:00+00:00'}], '2026-10-31T18:10:00Z'), {index:0, validUtc:'2026-10-31T18:10:00+00:00'});
console.log('archive timeline helper tests passed');
