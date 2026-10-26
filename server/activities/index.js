'use strict';

/**
 * Activity registry. To add a new activity, create a module exporting
 * { id, create(options, info), view?(state, pid, pids), actions: { name(state, data, ctx) }, onLeave? }
 * and add it to the list below (plus a matching client module in public/js/activities).
 */
const list = [
  require('./puzzle'),
  require('./paint'),
  require('./lego'),
  require('./guess'),
  require('./bluetooth'),
];

const byId = new Map(list.map((a) => [a.id, a]));

module.exports = {
  get: (id) => byId.get(id),
  ids: () => [...byId.keys()],
};
