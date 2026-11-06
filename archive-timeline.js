/* Native archive time joins. Missing timestamps remain gaps; values are never interpolated. */
(function (root) {
  function utcOf(time) { return typeof time === 'string' ? time : time?.utc; }

  function createArchiveTimeline() {
    function build(product, rainfallTimes = [], crestTimes = []) {
      const source = product === 'rainfall' ? rainfallTimes : product === 'crest' ? crestTimes : [...rainfallTimes, ...crestTimes];
      const unique = new Map();
      for (const time of source) {
        const utc = utcOf(time), epoch = Date.parse(utc);
        if (Number.isFinite(epoch) && !unique.has(epoch)) unique.set(epoch, new Date(epoch).toISOString());
      }
      return [...unique.entries()].sort(([a], [b]) => a - b).map(([, utc]) => utc);
    }

    function resolveRainfall(times, utc) {
      const target = Date.parse(utc);
      let index = -1;
      for (let i = 0; i < (times?.length || 0); i++) {
        const valid = Date.parse(utcOf(times[i]));
        if (Number.isFinite(valid) && valid <= target) index = i;
        else if (valid > target) break;
      }
      return index < 0 ? null : {index, validUtc: utcOf(times[index])};
    }

    function resolveCrest(times, utc) {
      const target = Date.parse(utc);
      const index = (times || []).findIndex(time => Date.parse(utcOf(time)) === target);
      return index < 0 ? null : {index, validUtc: utcOf(times[index])};
    }

    function nearest(times, utc) {
      if (!times?.length) return 0;
      const target = Date.parse(utc);
      let best = 0;
      let distance = Math.abs(Date.parse(utcOf(times[0])) - target);
      for (let i = 1; i < times.length; i++) {
        const next = Math.abs(Date.parse(utcOf(times[i])) - target);
        if (next < distance) { best = i; distance = next; }
      }
      return best;
    }

    return {build, resolveRainfall, resolveCrest, nearest};
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = {createArchiveTimeline};
  root.createArchiveTimeline = createArchiveTimeline;
})(typeof window !== 'undefined' ? window : globalThis);
